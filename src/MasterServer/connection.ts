import { debug, type BufferLike } from '../utils';
import { EventEmitter } from 'events';
import { createSocket } from 'dgram';

export interface BaseOptions {
	ip: string;
	port: number;
	timeout: number;
	debug: boolean;
	enableWarns: boolean;
}

const connections: Record<string, Connection> = {};
const client = createSocket('udp4')
	.on('message', (buffer, rinfo) => {
		if(buffer.length === 0) return;

		const address = `${rinfo.address}:${rinfo.port}`;

		if(!(address in connections)) return;
		const connection = connections[address] as Connection;

		if(connection.options.debug) debug('MASTER_SERVER recieved:', buffer);

		const packet = packetHandler(buffer, connection);
		if(!packet) return;

		connection.emit('packet', packet, address);
	})
	.unref();

// #region Packet Handlers
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
function packetHandler(buffer: Buffer, connection: Connection): Buffer | void {
	if(buffer.readInt32LE() === -1) return buffer.slice(4);

	const { options } = connection;
	if(options.debug) debug('MASTER_SERVER cannot parse packet', buffer);
	if(options.enableWarns){
		// eslint-disable-next-line no-console
		console.error(new Error("Warning: a packet couln't be handled"));
	}
}
// #endregion

export default class Connection extends EventEmitter{
	constructor(options: BaseOptions){
		super();
		this.options = options;

		this.address = `${options.ip}:${options.port}`;
		connections[this.address] = this;

		client.setMaxListeners(client.getMaxListeners() + 20);
	}
	public readonly address: string;
	public readonly options: BaseOptions;

	public readonly packetsQueues = {};
	public lastPing = -1;

	public send(command: BufferLike): Promise<void> {
		if(this.options.debug) debug('MASTER_SERVER sent:', command);

		return new Promise((res, rej) => {
			client.send(
				Buffer.from(command),
				this.options.port,
				this.options.ip,
				err => {
					if(err) return rej(err);
					res();
				}
			);
		});
	}

	/* eslint-disable @typescript-eslint/no-use-before-define */
	public awaitResponse(responseHeaders: number[]): Promise<Buffer> {
		return new Promise((res, rej) => {
			const clear = (): void => {
				this.off('packet', onPacket);
				client.off('error', onError);
				clearTimeout(timeout);
			};

			const onError = (err: unknown): void => {
				clear(); rej(err);
			};
			const onPacket = (buffer: Buffer, address: string): void => {
				if(
					this.address !== address ||
					!responseHeaders.includes(buffer[0] as number)
				) return;

				clear(); res(buffer);
			};

			const timeout = setTimeout(onError, this.options.timeout, new Error('Response timeout.'));

			this.on('packet', onPacket);
			client.on('error', onError);
		});
	}
	/* eslint-enable @typescript-eslint/no-use-before-define */

	public async query(command: BufferLike, ...responseHeaders: number[]): Promise<Buffer> {
		await this.send(command);

		const timeout = setTimeout(() => {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			this.send(command).catch(() => {});
		}, this.options.timeout / 2);

		const start = Date.now();
		return await this.awaitResponse(responseHeaders)
			.then(value => {
				this.lastPing = Date.now() - start;
				return value;
			})
			.finally(() => clearTimeout(timeout));
	}

	public destroy(): void {
		client.setMaxListeners(client.getMaxListeners() - 20);
		delete connections[this.address];
	}
}
