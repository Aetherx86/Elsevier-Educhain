const http = require('http');
const crypto = require('crypto');

const ipfsStore = {};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/v0/add') {
    let body = [];
    req.on('data', chunk => {
      body.push(chunk);
    });
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const contentStr = buffer.toString('utf-8');
      
      // Simple multipart/form-data parser (extract just the JSON part)
      let extractedContent = contentStr;
      const jsonStart = contentStr.indexOf('{');
      const jsonEnd = contentStr.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        extractedContent = contentStr.substring(jsonStart, jsonEnd + 1);
      }

      const hash = crypto.createHash('sha256').update(extractedContent).digest('hex');
      const pseudoCid = 'Qm' + hash.substring(0, 44);
      
      ipfsStore[pseudoCid] = extractedContent;
      console.log(`[Mock IPFS] Added ${pseudoCid}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        Name: 'file',
        Hash: pseudoCid,
        Size: buffer.length
      }));
    });
  } 
  else if (req.method === 'POST' && url.pathname === '/api/v0/cat') {
    const cid = url.searchParams.get('arg');
    if (!cid || !ipfsStore[cid]) {
      console.log(`[Mock IPFS] Cat failed for ${cid}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    console.log(`[Mock IPFS] Cat success for ${cid}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(ipfsStore[cid]);
  }
  else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(5002, '0.0.0.0', () => {
  console.log('Mock IPFS server running on http://0.0.0.0:5002');
});
