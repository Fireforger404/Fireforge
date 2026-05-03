// netlify/functions/ai-plan.js
// Securely proxies requests to the Anthropic API.
// Your ANTHROPIC_API_KEY lives only in Netlify environment variables,
// never exposed in the browser.

exports.handler = async function(event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Basic CORS headers so your frontend can call this function
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(event.body);
    const { prompt, max_tokens } = body;

    if (!prompt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt is required' }) };
    }

    // Call Anthropic API using the server-side key
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'AI service error', detail: errText }) };
    }

    const data = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', detail: err.message }) };
  }
};
