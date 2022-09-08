/* eslint-disable no-invalid-this */
// @ts-nocheck
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-invalid-this */
/* eslint-env mocha */
const { Server, RCON, MasterServer } = require('../lib');

// https://www.freegamehosting.eu/stats#garrysmod
const regex = /connect (\S+):(\d+) ; rcon_password (\S+)/;
const [ip, port, password] = regex.exec(
	'connect 49.12.122.244:33036 ; rcon_password cosas'.trim()
).slice(1);

const options = {
	ip,
	port: parseInt(port),
	password,

	enableWarns: false,
	debug: false,
};

const result = {
	MasterServer: null,
	server: {},
	RCON: {},
};

function MyError(message, stack = ''){
	const err = new Error(message);
	err.stack = stack;

	return err;
}

describe('Server', () => {
	it('static getInfo()', async function(){
		this.retries(3);

		const info = await Server.getInfo(options);

		checkInfo(info);
		result.server['static getInfo()'] = info;
	});

	const server = new Server();
	it('connect', async function(){
		this.retries(3);
		this.slow(9000);
		this.timeout(10000);

		await server.connect(options);
	});

	it('getInfo()', async () => {
		if(!server) throw MyError('Server not connected');

		const info = await server.getInfo();

		checkInfo(info);
		result.server.getInfo = info;
	});

	it('getPlayers()', async () => {
		if(!server) throw MyError('Server not connected');

		result.server.getPlayers = await server.getPlayers();
	});

	it('getRules()', async () => {
		if(!server) throw MyError('Server not connected');

		result.server.getRules = await server.getRules();
	});

	it('getPing()', async () => {
		if(!server) throw MyError('Server not connected');

		result.server.getPing = await server.getPing();
	});

	it('lastPing', () => {
		if(!server) throw MyError('Server not connected');

		if(typeof server.lastPing !== 'number' || isNaN(server.lastPing)){
			throw MyError('Server.lastPing is not a number');
		}else if(server.lastPing <= -1){
			throw MyError(`Server.lastPing is too small (${server.lastPing})`);
		}

		result.server.lastPing = server.lastPing;
	});
});

const ipv4RegexWithPort = /(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}/;
describe('MasterServer', () => {
	it('query', async () => {
		const IPs = await MasterServer({
			region: 'SOUTH_AMERICA',
			quantity: 900,
			timeout: 5000,
			debug: options.debug,
		});

		if(!Array.isArray(IPs)){
			throw new Error('ips is not an array');
		}else if(IPs.length === 0){
			throw new Error('ips is empty');
		}else if(IPs.some(x => typeof x !== 'string')){
			throw new Error('ips contains non-string values');
		}else if(IPs.some(str => !ipv4RegexWithPort.test(str))){
			throw new Error('ips contains invalid IPs');
		}else if(Math.abs(IPs.length - 900) > 100){
			throw new Error('ips does not have ~900 servers');
		}

		result.MasterServer = IPs;
	});

	/*
	it('filter', async function(){
		this.slow(14000);
		this.timeout(15000);

		const filter = new MasterServer.Filter()
			.add('map', 'de_dust2')
			.addFlag('linux')
			.addNOR(
				new MasterServer.Filter()
					.addFlag('secure')
			);

		const IPs = await MasterServer({
			// debug: true,
			filter,
			region: 'SOUTH_AMERICA',
			quantity: 1000,
		});

		const results = (await Promise.allSettled(IPs.map(address => {
			// eslint-disable-next-line @typescript-eslint/no-shadow
			const [ip, port] = address.split(':') as [string, string];

			return Server.getInfo({
				ip,
				port: parseInt(port),
			});
		})))
			.filter(x => x.status === 'fulfilled') as PromiseFulfilledResult<FinalServerInfo>[];

		const satisfiesFilter = results
			.map(x => x.value)
			.filter(x =>
				x.OS === 'linux' &&
				x.map === 'de_dust2' &&
				!x.VAC
			)
			.length;

		if(results.length - satisfiesFilter < results.length * 0.1){ // master servers are not perfect
			throw new Error('Filter is not working well');
		}
	});
	*/
});

describe('RCON', () => {
	// eslint-disable-next-line @typescript-eslint/init-declarations
	const rcon = new RCON();
	it('connect and authenticate', async function(){
		this.retries(3);

		await rcon.connect(options);
	});

	it("exec('sv_gravity') (single packet response)", async () => {
		if(!rcon) throw MyError('RCON not connected');

		result.RCON["exec('sv_gravity')"] = await rcon.exec('sv_gravity');
	});

	it("exec('cvarlist') (multiple packet response)", async function(){
		this.slow(9000);
		this.timeout(10000);
		if(!rcon) throw MyError('RCON not connected');

		result.RCON["exec('cvarlist')"] = await rcon.exec('cvarlist');
	});

	it("exec('status')", async () => {
		if(!rcon) throw MyError('RCON not connected');

		result.RCON["exec('status')"] = await rcon.exec('status');
	});

	it('multiple requests', async function(){
		this.slow(9000);
		this.timeout(10000);

		await Promise.all([
			rcon.exec('cvarlist'),
			rcon.exec('status'),
			rcon.exec('sv_gravity'),
		]);

		await Promise.all([
			rcon.exec('sv_gravity'),
			rcon.exec('status'),
			rcon.exec('cvarlist'),
		]);
	});

	it('should reconnect', async () => {
		if(!rcon) throw MyError('RCON not connected');

		rcon.exec('sv_gravity 0').catch(() => { /* do nothing */ });

		await shouldFireEvent(rcon, 'disconnect', 3000);
		await rcon.reconnect();

		rcon.exec('sv_gravity 0').catch(() => { /* do nothing */ });

		await shouldFireEvent(rcon, 'disconnect', 3000);
		await rcon.reconnect();
	});

	it('should manage password changes', async () => {
		if(!rcon || !rcon.connection._ready) throw MyError('RCON not connected');

		rcon.exec('rcon_password cosas2').catch(() => { /* do nothing */ });
		await shouldFireEvent(rcon, 'disconnect', 3000);

		await Promise.all([
			rcon.reconnect(),
			shouldFireEvent(rcon, 'passwordChange', 3000),
		]);

		await rcon.authenticate('cosas2');


		rcon.exec('rcon_password cosas').catch(() => { /* do nothing */ });
		await shouldFireEvent(rcon, 'disconnect', 3000);

		await Promise.all([
			rcon.reconnect(),
			shouldFireEvent(rcon, 'passwordChange', 3000),
		]);

		await rcon.authenticate('cosas');
	});
});

let id = 1;
/* eslint-disable no-use-before-define */
function shouldFireEvent(obj, event, time){
	const err = new Error(`Event ${event} (${id++}) not fired`);

	return new Promise((res, rej) => {
		const clear = () => {
			obj.off(event, onEvent);
			clearTimeout(timeout);
		};
		const onEvent = () => {
			clear(); res();
		};

		const timeout = setTimeout(() => {
			clear();
			rej(err);
		}, time).unref();
		obj.on(event, onEvent);
	});
}
/* eslint-enable no-use-before-define */

function checkInfo(info){
	for(const key of ['appID', 'OS', 'protocol', 'version', 'map']){
		if(!(key in info)){
			throw new Error('Missing keys in data');
		}
	}
}