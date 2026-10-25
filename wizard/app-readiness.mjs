import http from 'node:http';
import https from 'node:https';

// A listening socket is insufficient: wait for an actual HTTP response.
export function probeApplicationUrl(url, { timeout = 1000, allowNotFound = false, redirects = 3 } = {}) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { resolve(false); return; }
    if (!['http:', 'https:'].includes(target.protocol)) { resolve(false); return; }
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value); } };
    const request = (target.protocol === 'https:' ? https : http).get(target, (response) => {
      const code = response.statusCode;
      response.resume();
      if ([301, 302, 303, 307, 308].includes(code)) {
        if (!response.headers.location || redirects <= 0) { finish(false); return; }
        let next;
        try { next = new URL(response.headers.location, target); } catch { finish(false); return; }
        void probeApplicationUrl(next, { timeout, allowNotFound, redirects: redirects - 1 }).then(finish);
        return;
      }
      finish(code >= 200 && (code < 400 || code === 401 || code === 403 || (allowNotFound && code === 404)));
    });
    const deadline = setTimeout(() => { request.destroy(); finish(false); }, timeout);
    request.on('error', () => finish(false));
  });
}
