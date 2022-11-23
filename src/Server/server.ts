/* eslint-disable new-cap */
import { debug } from '../utils';
import Connection, { PrivateConnection } from '../connection';
import * as parsers from './serverParsers';
import { checkOptions, type RawOptions, type ServerData } from './options';

enum RequestType {
	INFO = 0x54,
	PLAYERS = 0x55,
	RULES = 0x56,
	CHALLENGE = 0x57,
	PING = 0x69,
}

enum ResponseType {
	INFO = 0x49,
	GOLDSOURCE_INFO = 0x6D,
	PLAYERS = 0x44,
	RULES = 0x45,
	CHALLENGE = 0x41,
	PING = 0x6A,
}

const FFFFFFFFh = [0xFF, 0xFF, 0xFF, 0xFF] as const;
const CHALLENGE_IDS = [ 17510, 17520, 17740, 17550, 17700 ] as const;
const COMMANDS = {
	INFO_BASE: Buffer.from([
		...FFFFFFFFh, RequestType.INFO,
		...Buffer.from('Source Engine Query\0'),
	]),
	INFO(key: Buffer | [] = []){
		return Buffer.from([ ...COMMANDS.INFO_BASE, ...key ]);
	},
	CHALLENGE(code = RequestType.CHALLENGE, key = FFFFFFFFh){
		return Buffer.from([ ...FFFFFFFFh, code, ...key ]);
	},
	PING: Buffer.from([ ...FFFFFFFFh, RequestType.PING ]),
};

export default class Server{
	constructor(options: RawOptions, privateConnection = false){
		// @ts-expect-error data is incomplete at this point
		this.data = options;
		if(privateConnection){
			this.connection = new PrivateConnection(this.data);
		}else{
			this.connection = new Connection(this.data);
		}
	}
	private readonly connection: Connection<ServerData> | PrivateConnection<ServerData>;
	public data: ServerData;
	public isConnected = false;

	public async getInfo(): Promise<parsers.FinalServerInfo> {
		if(!this.isConnected){
			throw new Error('Not connected');
		}

		let command = COMMANDS.INFO();
		if(this.data.info.challenge){
			const response = await this.connection.query(command, ResponseType.CHALLENGE);
			const key = response.slice(-4);

			command = COMMANDS.INFO(key);
		}

		const requests = this.data.info.goldSource ? [
			this.connection.query(command, ResponseType.INFO),
			this.connection.awaitResponse([ResponseType.GOLDSOURCE_INFO]),
		] : [
			this.connection.query(command, ResponseType.INFO),
		];

		const responses = await Promise.all(requests);

		return Object.assign({}, ...responses.map(parsers.serverInfo)) as parsers.FinalServerInfo;
	}

	public async getPlayers(): Promise<parsers.Players> {
		if(!this.isConnected){
			throw new Error('Not connected');
		}

		const key = await this.challenge(RequestType.PLAYERS);

		if(key[0] === ResponseType.PLAYERS && key.length > 5){
			return parsers.players(Buffer.from(key), this.data);
		}

		const command = Buffer.from([
			...FFFFFFFFh, RequestType.PLAYERS, ...key.slice(1),
		]);
		const response = await this.connection.query(command, 0x44);

		if(Buffer.compare(response, Buffer.from(key)) === 0){
			throw new Error('Wrong server response');
		}

		return parsers.players(response, this.data);
	}

	public async getRules(): Promise<parsers.Rules>{
		if(!this.isConnected){
			throw new Error('Not connected');
		}

		const key = await this.challenge(RequestType.RULES);

		if(key[0] === ResponseType.RULES && key.length > 5){
			return parsers.rules(Buffer.from(key));
		}

		const command = Buffer.from([
			...FFFFFFFFh, RequestType.RULES, ...key.slice(1),
		]);
		const response = await this.connection.query(command, ResponseType.RULES);

		if(Buffer.compare(response, Buffer.from(key)) === 0){
			throw new Error('Wrong server response');
		}

		return parsers.rules(response);
	}

	public async getPing(): Promise<number> {
		if(!this.isConnected){
			throw new Error('Not connected');
		}

		if(this.data.enableWarns){
			// eslint-disable-next-line no-console
			console.trace('A2A_PING request is a deprecated feature of source servers');
		}

		try{
			const start = Date.now();
			await this.connection.query(COMMANDS.PING, ResponseType.PING);

			return Date.now() - start;
		}catch(e){
			return -1;
		}
	}

	public async challenge(code: number): Promise<Buffer> {
		if(!this.isConnected){
			throw new Error('Not connected');
		}

		const command = COMMANDS.CHALLENGE();
		// @ts-expect-error https://github.com/microsoft/TypeScript/issues/26255
		if(!CHALLENGE_IDS.includes(this.data.appID)){
			command[4] = code;
		}

		// 0x41 normal challenge response
		// 0x44 truncated rules response
		// 0x45 truncated players response
		const response = await this.connection.query(command, ResponseType.CHALLENGE, code - 0b10001);

		return response;
	}

	public async connect(): Promise<void> {
		if(this.isConnected){
			throw new Error('Server: already connected.');
		}
		await checkOptions(this.data);
		await this.connection.connect();

		const info = await aloneGetInfo(this.connection);
		if(this.data.debug) debug('SERVER connected');

		Object.assign(this.data, {
			info: {
				challenge: info.needsChallenge,
				goldSource: info.goldSource,
			},
			appID: info.appID,
			protocol: info.protocol,
		});

		this.isConnected = true;
	}

	public disconnect(): void {
		if(!this.isConnected){
			throw new Error('Not connected');
		}
		this.connection.destroy();
		this.isConnected = false;
	}

	public static async getInfo(options: RawOptions): Promise<parsers.FinalServerInfo> {
		await checkOptions(options);

		const connection = new Connection(options as ServerData);
		connection.connect();
		const info = await aloneGetInfo(connection);

		connection.destroy();
		return info;
	}
}

type AloneServerInfo = parsers.FinalServerInfo & { needsChallenge: boolean };
async function aloneGetInfo(connection: Connection<ServerData>, challenge: Buffer | null = null): Promise<AloneServerInfo> {
	if(challenge === null){
		await connection.send(COMMANDS.INFO());
	}else{
		await connection.send(COMMANDS.INFO(challenge));
	}

	const responses = [];

	connection.awaitResponse([ResponseType.GOLDSOURCE_INFO])
		.then(data => responses.push(data))
		.catch(() => { /* do nothing */ });

	const INFO = await connection.awaitResponse([ResponseType.INFO, ResponseType.CHALLENGE]);
	if(INFO[0] === ResponseType.CHALLENGE){
		if(challenge !== null){
			throw new Error('Wrong server response');
		}

		// needs challenge
		return await aloneGetInfo(connection, INFO.slice(1));
	}
	responses.push(INFO);

	return Object.assign({
		address: `${connection.data.ip}:${connection.data.port}`,
		needsChallenge: challenge !== null,
	}, ...responses.map(parsers.serverInfo)) as AloneServerInfo;
}
