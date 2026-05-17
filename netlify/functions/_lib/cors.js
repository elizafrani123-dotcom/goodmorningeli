// Shared CORS + JSON response helpers for all functions.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  };
}

// Wrap a handler so it transparently handles OPTIONS preflight and errors,
// and always returns CORS headers.
function cors(handler) {
  return async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: CORS_HEADERS,
        body: '',
      };
    }
    try {
      const result = await handler(event, context);
      // Merge CORS headers into the handler's response.
      if (result && typeof result === 'object') {
        return {
          ...result,
          headers: {
            ...CORS_HEADERS,
            ...(result.headers || {}),
          },
        };
      }
      return result;
    } catch (err) {
      console.error('[handler error]', err);
      return json(500, { error: err.name || 'Error', message: err.message || String(err) });
    }
  };
}

module.exports = { cors, json, CORS_HEADERS };
