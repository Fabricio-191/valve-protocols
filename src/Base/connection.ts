import { debug } from './utils';
import { createSocket, type Socket } from 'dgram';
import type { BaseData } from './options';

export default abstract class BaseConnection {
	constructor(data: BaseData) {
		this.data = data;

		this.socket = createSocket('udp4')
			.on('message', buffer => {
				debug(this.data, 'recieved:', buffer);

				// some old servers just thought it would be a good idea to send empty useless packets in very rare occasions
				if(buffer.length !== 0) this.onMessage(buffer);
			})
			.unref();
	}
	public readonly data: BaseData;
	protected readonly socket: Socket;

	private _isConnected: Promise<void> | false = false;
	public async mustBeConnected(): Promise<void> {
		if(!this._isConnected) throw new Error('Not connected/ing');
		await this._isConnected;
	}

	protected abstract onMessage(buffer: Buffer): void;

	public connect(): Promise<void> {
		this._isConnected = new Promise((res, rej) => {
			// @ts-expect-error asdasdasd
			this.socket.connect(this.data.port, this.data.ip, (err: unknown) => {
				if(err) rej(err);
				else res();
			});
		});

		return this._isConnected;
	}

	public destroy(): void {
		this.socket.close();
	}

	public async send(command: Buffer): Promise<void> {
		debug(this.data, 'sent:', command);

		return new Promise((res, rej) => {
			this.socket.send(command, err => {
				if(err) rej(err);
				else res();
			});
		});
	}

	public async awaitResponse(responseHeaders: readonly number[], timeoutTime = this.data.timeout): Promise<Buffer> {
		return new Promise((res, rej) => {
			const clear = (): void => {
				/* eslint-disable @typescript-eslint/no-use-before-define */
				this.socket
					.off('packet', onPacket)
					.off('error', onError);
				clearTimeout(timeout);
				/* eslint-enable @typescript-eslint/no-use-before-define */
			};

			const onError = (err: unknown): void => {
				clear(); rej(err);
			};
			const onPacket = (buffer: Buffer): void => {
				if(!responseHeaders.includes(buffer[0]!)) return;

				clear(); res(buffer);
			};

			const timeout = setTimeout(onError, timeoutTime, new Error('Response timeout.'));

			this.socket
				.on('packet', onPacket)
				.on('error', onError);
		});
	}

	public async query(command: Buffer, responseHeaders: readonly number[]): Promise<Buffer> {
		await this.send(command);

		const timeout = setTimeout(() => {
			this.send(command).catch(() => { /* do nothing */ });
		}, this.data.timeout / 2)
			.unref();

		return await this.awaitResponse(responseHeaders)
			.finally(() => clearTimeout(timeout));
	}
}
