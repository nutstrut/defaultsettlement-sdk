# SAR-402 Express Demo Live Proof

Date: 2026-06-20
Commit: b6d178a

## Normal mode
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 192
ETag: W/"c0-WZXBhW4zWWFGMlkv0qRpUQ0cW+Q"
X-DefaultSettlement-Mode: record
X-DefaultSettlement-Receipt-ID: sha256:8f6816a1f2b8f578bb27c925111283439ecaff66a56c46c4f712b13bdbbf9cbb
X-DefaultSettlement-Explorer-URL: https://defaultverifier.com/explorer?receipt_id=sha256%3A8f6816a1f2b8f578bb27c925111283439ecaff66a56c46c4f712b13bdbbf9cbb
Date: Sat, 20 Jun 2026 17:18:47 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"url":"https://example.com","summary":"Summary of https://example.com: lorem ipsum (simulated paid output).","paymentRef":"0x553f4f52efed64d27dc6bbd1a2b8770bff323a8dae85bb676680506e0d43e535"}
## Fail-open mode
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 192
ETag: W/"c0-4v18PlBcx547Lqv/lLKHiCMc0EM"
X-DefaultSettlement-Mode: record
Date: Sat, 20 Jun 2026 17:20:41 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"url":"https://example.com","summary":"Summary of https://example.com: lorem ipsum (simulated paid output).","paymentRef":"0x1675aa9c47965b26684d145b0566bc7611c7a47e4973dc613bfbd19c4db3d59b"}