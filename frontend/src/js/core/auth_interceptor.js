    // --- Master Security & Authentication Interceptor ---
    (function() {
      // 1. Intercept URL token query parameter (?token=...)
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token');
      if (queryToken) {
        localStorage.setItem('nexusdesk_token', queryToken.trim());
        // Strip token from browser address bar for zero-exposure hygiene
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }

      // 2. Wrap window.fetch to automatically attach Authorization header, instance header, anti-cache & handle 401
      const originalFetch = window.fetch;
      window.fetch = async function(url, options = {}) {
        const token = localStorage.getItem('nexusdesk_token');
        let urlString = typeof url === 'string' ? url : (url.url || '');
        
        // Only intercept /api/ requests
        if (urlString.startsWith('/api/') || urlString.includes('/api/')) {
          options = options || {};
          const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
          const currentInst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');

          // Append ?instance= if not present
          if (!urlString.includes('instance=')) {
            const sep = urlString.includes('?') ? '&' : '?';
            urlString = `${urlString}${sep}instance=${encodeURIComponent(currentInst)}`;
            if (typeof url === 'string') {
              url = urlString;
            }
          }

          // Anti-stale timestamp for GET requests
          const method = (options.method || 'GET').toUpperCase();
          if (method === 'GET' && !urlString.includes('_t=')) {
            const sep = urlString.includes('?') ? '&' : '?';
            urlString = `${urlString}${sep}_t=${Date.now()}`;
            if (typeof url === 'string') {
              url = urlString;
            }
          }

          // Do NOT force Content-Type or plain object header traps when sending FormData
          if (options.headers instanceof Headers) {
            if (token) {
              options.headers.set('Authorization', `Bearer ${token}`);
              options.headers.set('X-NexusDesk-Token', token);
            }
            if (!options.headers.has('X-NexusDesk-Instance')) {
              options.headers.set('X-NexusDesk-Instance', currentInst);
            }
            options.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            options.headers.set('Pragma', 'no-cache');
          } else if (Array.isArray(options.headers)) {
            if (token) {
              options.headers.push(['Authorization', `Bearer ${token}`]);
              options.headers.push(['X-NexusDesk-Token', token]);
            }
            options.headers.push(['X-NexusDesk-Instance', currentInst]);
            options.headers.push(['Cache-Control', 'no-cache, no-store, must-revalidate']);
            options.headers.push(['Pragma', 'no-cache']);
          } else {
            // Plain object
            options.headers = options.headers ? { ...options.headers } : {};
            if (token) {
              options.headers['Authorization'] = `Bearer ${token}`;
              options.headers['X-NexusDesk-Token'] = token;
            }
            if (!options.headers['X-NexusDesk-Instance']) {
              options.headers['X-NexusDesk-Instance'] = currentInst;
            }
            options.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            options.headers['Pragma'] = 'no-cache';
            
            // If body is FormData, ensure Content-Type is NEVER manually set so the browser creates multipart boundary
            if (isFormData && options.headers['Content-Type']) {
              delete options.headers['Content-Type'];
            }
            if (isFormData && options.headers['content-type']) {
              delete options.headers['content-type'];
            }
          }
        }

        try {
          const response = await originalFetch.call(this, url, options);
          if (response.status === 401 && (urlString.startsWith('/api/') || urlString.includes('/api/')) && !urlString.includes('/api/auth/verify')) {
            if (typeof showAuthUnlockModal === 'function') {
              showAuthUnlockModal();
            }
          }
          return response;
        } catch (err) {
          throw err;
        }
      };
    })();

