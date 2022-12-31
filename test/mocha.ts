/* eslint-disable new-cap, @typescript-eslint/no-invalid-this */
/* eslint-env mocha */
import type { EventEmitter } from 'events';
import { Server, RCON, MasterServer, debug, type AnyServerInfo } from '../src';
debug.enable('./test/debug.log');

const doNothing = (): void => { /* do nothing */ };

// https://www.freegamehosting.eu/stats#garrysmod
const options = {
	ip: '49.12.122.244:33006',
	password: 'cosas',
	enableWarns: false,
};

describe('Server', () => {
	function checkInfo(info: object): void {
		for(const key of ['appID', 'OS', 'protocol', 'version', 'map']){
			if(!(key in info)){
				throw new Error('Missing keys in data');
			}
		}
	}

	it('static getInfo()', async () => {
		const info = await Server.getInfo(options);

		checkInfo(info);
	});

	const server = new Server();
	it('connect', async function(){
		this.slow(9000);
		this.timeout(10000);

		await server.connect(options);
	});

	it('getInfo()', async () => {
		const info = await server.getInfo();

		checkInfo(info);
		debug(info, 'Server info');
	});

	it('getPlayers()', async () => {
		const players = await server.getPlayers();
		debug(players, 'Server players');
	});

	it('getRules()', async () => {
		const rules = await server.getRules();
		debug(rules, 'Server rules');
	});

	/*
	it('getPing()', async () => {
		const ping = await server.getPing();
		debug(ping, 'Server ping');
	});
	*/

	it('lastPing', () => {
		if(typeof server.lastPing !== 'number' || isNaN(server.lastPing)){
			throw new Error('Server.lastPing is not a number');
		}else if(server.lastPing <= -1){
			throw new Error(`Server.lastPing is too small (${server.lastPing})`);
		}

		debug(server.lastPing, 'Server ping');
	});
});

describe('MasterServer', () => {
	const ipv4RegexWithPort = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;

	function checkIP(ip: unknown): void {
		if(typeof ip !== 'string') throw new Error('IP is not a string');

		const matches = ipv4RegexWithPort.exec(ip);
		if(!matches) throw new Error('IP is not valid');

		for(let i = 1; i < 5; i++){
			const num = Number(matches[i]);
			if(num < 0 || num > 255){
				throw new Error('Field in IP is not valid');
			}
		}

		const port = Number(matches[5]);
		if(port < 0 || port > 65535){
			throw new Error('Port in IP is not valid');
		}
	}

	it('query', async function(){
		this.slow(14000);
		this.timeout(15000);

		const IPs = await MasterServer({
			region: 'SOUTH_AMERICA',
			quantity: 900,
			timeout: 5000,
		});

		if(!Array.isArray(IPs)){
			throw new Error('ips is not an array');
		}else if(Math.abs(IPs.length - 900) > 100){ // 900 ± 100
			throw new Error('ips does not have ~900 servers');
		}

		IPs.forEach(checkIP);

		debug(IPs, 'MasterServer result');
	});

	it('filter', async function(){
		this.slow(14000);
		this.timeout(15000);

		const filter = new MasterServer.Filter()
			.appId(730)
			.is('linux', 'dedicated', 'password_protected')
			.is('not_secure');

		const IPs = await MasterServer({
			filter,
			region: 'SOUTH_AMERICA',
			quantity: 1000,
		});

		const results = await Promise.allSettled(IPs.map(Server.getInfo));

		const satisfiesFilter = results
			.filter(x => x.status === 'fulfilled')
			// @ts-expect-error promise are fullfiled
			.map(x => x.value as AnyServerInfo)
			.filter((x: AnyServerInfo) =>
				('appID' in x ? x.appID : -1) === 730 &&
				x.OS === 'linux' &&
				x.type === 'dedicated' &&
				x.hasPassword &&
				!x.VAC
			)
			.length;

		if(results.length - satisfiesFilter < results.length * 0.1){ // (10% error margin) master servers are not perfect
			throw new Error('Filter is not working well');
		}
	});
});

describe('RCON', () => {
	const rcon = new RCON();

	it('connect and authenticate', () => rcon.connect(options));

	it("exec('sv_gravity') (single packet response)", async () => {
		const result = await rcon.exec('sv_gravity');
		debug(result, "exec('sv_gravity')");
	});

	it("exec('cvarlist') (multiple packet response)", async function(){
		this.slow(9000);
		this.timeout(10000);

		const result = await rcon.exec('cvarlist');
		debug(result, "exec('cvarlist')");
	});

	it("exec('status')", async () => {
		const result = await rcon.exec('status');
		debug(result, "exec('status')");
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
		rcon.exec('sv_gravity 0').catch(doNothing);
		await shouldFireEvent(rcon, 'disconnect', 3000);
		await rcon.reconnect();

		rcon.exec('sv_gravity 0').catch(doNothing);

		await shouldFireEvent(rcon, 'disconnect', 3000);
		await rcon.reconnect();
	});

	it('should manage password changes', async () => {
		rcon.exec('rcon_password cosas2').catch(doNothing);
		await shouldFireEvent(rcon, 'disconnect', 3000);

		await Promise.all([
			rcon.reconnect(),
			shouldFireEvent(rcon, 'passwordChange', 3000),
		]);

		await rcon.authenticate('cosas2');


		rcon.exec('rcon_password cosas').catch(doNothing);
		await shouldFireEvent(rcon, 'disconnect', 3000);

		await Promise.all([
			rcon.reconnect(),
			shouldFireEvent(rcon, 'passwordChange', 3000),
		]);

		await rcon.authenticate('cosas');
	});
});

let id = 1;
function shouldFireEvent(obj: EventEmitter, event: string, time: number): Promise<void> {
	const err = new Error(`Event ${event} (${id++}) not fired`);

	return new Promise((res, rej) => {
		const end = (error?: unknown): void => {
			obj.off(event, end);
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			clearTimeout(timeout);

			if(error) rej(err);
			else res();
		};

		const timeout = setTimeout(end, time, err).unref();
		obj.on(event, () => end());
	});
}
