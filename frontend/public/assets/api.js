/**
 * PCCA Portal — API client.
 *
 * The ONLY place in the frontend that calls fetch(). Components go
 * through here so that auth refresh, CSRF headers and error shaping
 * happen in one place (docs/rules.md).
 *
 * Note what is NOT in this file, and never should be:
 *   - no API keys, no secrets, no database credentials
 *   - no JWT handling; tokens live in httpOnly cookies the browser
 *     attaches automatically and JavaScript cannot read
 *   - no role logic that decides access; the server decides, this
 *     only decides what to draw
 */
(function (global) {
  'use strict';

  var BASE = (global.PCCA_API_BASE || '/api').replace(/\/$/, '');

  function ApiError(message, code, status, fields) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.code = code;
    e.status = status;
    e.fields = fields || [];
    return e;
  }

  var refreshing = null;

  function request(method, path, options) {
    options = options || {};
    var isForm = options.body instanceof FormData;

    var headers = {
      // Cannot be set by a cross-origin form post without a CORS
      // preflight, which the server refuses. Second CSRF layer
      // behind SameSite=strict cookies.
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (!isForm && options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(BASE + path, {
      method: method,
      credentials: 'same-origin',   // sends the httpOnly cookies
      headers: Object.assign(headers, options.headers || {}),
      body: isForm ? options.body
           : options.body !== undefined ? JSON.stringify(options.body)
           : undefined,
    }).then(function (res) {
      // Access token expired — refresh once, then replay.
      if (res.status === 401 && !options._retried && path !== '/auth/refresh') {
        if (!refreshing) {
          refreshing = request('POST', '/auth/refresh', { _retried: true })
            .finally(function () { refreshing = null; });
        }
        return refreshing.then(function () {
          return request(method, path, Object.assign({}, options, { _retried: true }));
        });
      }

      var type = res.headers.get('content-type') || '';
      if (!type.includes('application/json')) {
        if (!res.ok) throw ApiError('The server did not respond correctly.', 'BAD_RESPONSE', res.status);
        return res;
      }

      return res.json().then(function (data) {
        if (!res.ok) {
          var err = (data && data.error) || {};
          throw ApiError(
            err.message || 'Something went wrong.',
            err.code || 'UNKNOWN',
            res.status,
            err.fields
          );
        }
        return data;
      });
    });
  }

  var api = {
    ApiError: ApiError,

    health: function () { return request('GET', '/health'); },

    /* ---------- offices (public) ---------- */
    offices: {
      list: function (params) {
        var qs = new URLSearchParams();
        Object.keys(params || {}).forEach(function (k) {
          if (params[k]) qs.append(k, params[k]);
        });
        var q = qs.toString();
        return request('GET', '/offices' + (q ? '?' + q : ''));
      },
      get: function (id) { return request('GET', '/offices/' + encodeURIComponent(id)); },
      totals: function () { return request('GET', '/offices/totals'); },
      facets: function () { return request('GET', '/offices/facets'); },
      strengthByOrg: function () { return request('GET', '/offices/strength-by-org'); },
      updateContact: function (id, body) {
        return request('PATCH', '/offices/' + encodeURIComponent(id) + '/contact', { body: body });
      },
      updateStrength: function (id, body) {
        return request('PATCH', '/offices/' + encodeURIComponent(id) + '/strength', { body: body });
      },
      derivedReview: function () { return request('GET', '/offices/derived-review'); },
    },

    /* ---------- auth ---------- */
    auth: {
      // Step 1. Returns a challenge, not a session.
      login: function (email, password) {
        return request('POST', '/auth/login', { body: { email: email, password: password } });
      },
      // Step 2. Sets httpOnly cookies server-side.
      verifyOtp: function (challengeId, otp) {
        return request('POST', '/auth/verify-otp', { body: { challengeId: challengeId, otp: otp } });
      },
      me: function () { return request('GET', '/auth/me'); },
      logout: function () { return request('POST', '/auth/logout'); },
      changePassword: function (currentPassword, newPassword) {
        return request('POST', '/auth/change-password', {
          body: { currentPassword: currentPassword, newPassword: newPassword },
        });
      },
    },

    /* ---------- documents ---------- */
    documents: {
      byOffice: function (officeId) {
        return request('GET', '/documents/office/' + encodeURIComponent(officeId));
      },
      get: function (id) { return request('GET', '/documents/' + encodeURIComponent(id)); },
      versions: function (id) { return request('GET', '/documents/' + encodeURIComponent(id) + '/versions'); },
      downloadUrl: function (id, versionId) {
        return BASE + '/documents/' + encodeURIComponent(id) + '/download' +
               (versionId ? '?versionId=' + encodeURIComponent(versionId) : '');
      },
      /** Upload with real progress. XHR rather than fetch, which has none. */
      upload: function (officeId, file, meta, onProgress) {
        return new Promise(function (resolve, reject) {
          var form = new FormData();
          form.append('file', file);
          Object.keys(meta).forEach(function (k) {
            if (meta[k] !== undefined && meta[k] !== null) form.append(k, meta[k]);
          });

          var xhr = new XMLHttpRequest();
          xhr.open('POST', BASE + '/documents/office/' + encodeURIComponent(officeId));
          xhr.withCredentials = true;
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable && onProgress) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = function () {
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (_) { data = {}; }
            if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
            var err = data.error || {};
            reject(ApiError(err.message || 'Upload failed.', err.code || 'UPLOAD_FAILED', xhr.status, err.fields));
          };
          xhr.onerror = function () {
            reject(ApiError('Could not reach the server.', 'NETWORK', 0));
          };
          xhr.send(form);
        });
      },
      withdraw: function (id) {
        return request('POST', '/documents/' + encodeURIComponent(id) + '/withdraw');
      },
    },

    /* ---------- public queries ---------- */
    queries: {
      forDocument: function (documentId) {
        return request('GET', '/queries/document/' + encodeURIComponent(documentId));
      },
      submit: function (body) { return request('POST', '/queries', { body: body }); },
    },

    /* ---------- administration (super admin) ---------- */
    admin: {
      users: function (params) {
        var qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/admin/users' + (qs ? '?' + qs : ''));
      },
      createUser: function (body) { return request('POST', '/admin/users', { body: body }); },
      setUserStatus: function (userId, status) {
        return request('PATCH', '/admin/users/' + encodeURIComponent(userId) + '/status', {
          body: { status: status },
        });
      },
      documentQueue: function () { return request('GET', '/admin/moderation/documents'); },
      moderateDocument: function (id, decision, remark) {
        return request('POST', '/admin/moderation/documents/' + encodeURIComponent(id), {
          body: { decision: decision, remark: remark },
        });
      },
      queryQueue: function () { return request('GET', '/admin/moderation/queries'); },
      moderateQuery: function (id, decision) {
        return request('POST', '/admin/moderation/queries/' + encodeURIComponent(id), {
          body: { decision: decision },
        });
      },
      audit: function (params) {
        var qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/admin/audit' + (qs ? '?' + qs : ''));
      },
      analytics: function () { return request('GET', '/admin/analytics'); },
    },
  };

  global.PCCA_API = api;
})(window);
