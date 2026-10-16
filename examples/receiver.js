// A minimal webhook receiver that verifies HookRelay signatures.
// Run: node examples/receiver.js   (then register http://host.docker.internal:4000 as an endpoint)
const http = require('http');
const { verify } = require('../src/signing');

const SECRET = process.env.WEBHOOK_SECRET; // the whsec_... value returned when you created the endpoint
if (!SECRET) {
  console.error('Set WEBHOOK_SECRET to the secret returned by POST /endpoints');
  process.exit(1);
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = verify(SECRET, body, req.headers['x-hookrelay-signature']);
      console.log(ok ? 'VALID  ' : 'INVALID', body);
      res.statusCode = ok ? 200 : 400;
      res.end();
    });
  })
  .listen(4000, () => console.log('receiver listening on :4000'));
