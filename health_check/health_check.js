var http = require("http");

http.createServer((request, response) => {
    if (request.url === '/health_check') {
        response.statusCode = 200;
        response.end();
    }
}).listen(2990);