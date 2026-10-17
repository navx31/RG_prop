/* Dev launcher — starts in-memory MongoDB, then boots server.js */
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
    const mem = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mem.getUri('rg_properties');
    console.log('⚠️  In-memory MongoDB started (data lost on restart)');
    require('./server.js');
})();