[![License](https://img.shields.io/github/license/Fabricio-191/valve-server-query?color=white&style=for-the-badge)](https://github.com/Fabricio-191/valve-server-query/blob/master/LICENSE)
[![Issues](https://img.shields.io/github/issues/Fabricio-191/valve-server-query?style=for-the-badge)](https://github.com/Fabricio-191/valve-server-query/issues)


# Implementation of some valve protocols:
## [Server query](https://developer.valvesoftware.com/wiki/Server_queries) and for [master server query](https://developer.valvesoftware.com/wiki/Master_Server_Query_Protocol)


Bzip decompression function was taken from [here](https://www.npmjs.com/package/bz2)

## Docs

* [Server query](https://github.com/Fabricio-191/valve-server-query/blob/master/docs/Server.md)
* [Master server query](https://github.com/Fabricio-191/valve-server-query/blob/master/docs/MasterServer.md)  
  
Later i will add RCON and after that i will add the 'filter' to `master server query` options

> If you have any error you can contact me on [Discord](https://discord.gg/zrESMn6) or [GitHub](https://github.com/Fabricio-191/valve-server-query/issues) (i prefer Discord)

## Use example

```js
const { Server, MasterServer } = require('@fabricio-191/valve-server-query');

MasterServer({
    quantity: 200
})
	.then(servers => {
		console.log(servers); //an array of 'ip:port' strings
	})
	.catch(console.error);

Server({
    ip: '0.0.0.0',
    port: 27015,
    timeout: 2000
})
  .then(async server => {
    const info = await server.getInfo();
    const players = await server.getPlayers();
    const rules = await server.getRules();

    console.log(info, players, rules);
  })
  .catch(console.error)
```