/********************************************************************************
 * Copyright (C) 2022 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { inject, injectable, postConstruct } from 'inversify';
import { BinaryBuffer } from '../../common/buffer';
import { CancellationToken } from 'vscode-languageserver-protocol';
import { BackendRequestService, RequestConfiguration, RequestContext, RequestOptions, RequestService } from '../../common/request';
import { PreferenceService } from '../preferences/preference-service';

@injectable()
export class DefaultBrowserRequestService implements RequestService {

    @inject(BackendRequestService)
    protected readonly backendRequestService: RequestService;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @postConstruct()
    protected init(): void {
        this.preferenceService.onPreferencesChanged(e => {
            const config: RequestConfiguration = {};
            if ('http.proxy' in e) {
                config.proxyUrl = e['http.proxy'].newValue;
            }
            if ('http.proxyAuthorization' in e) {
                config.proxyAuthorization = e['proxyAuthorization'].newValue;
            }
            if ('http.proxyStrictSSL' in e) {
                config.strictSSL = e['http.proxyStrictSSL'].newValue;
            }
            this.configure(config);
        });
    }

    configure(config: RequestConfiguration): void {
        this.backendRequestService.configure(config);
    }

    resolveProxy(url: string): Promise<string | undefined> {
        return this.backendRequestService.resolveProxy(url);
    }

    protected transformBackendResponse(context: RequestContext): RequestContext {
        const transferedBuffer = context.buffer.buffer as unknown as { data: number[] };
        context.buffer = BinaryBuffer.wrap(Uint8Array.from(transferedBuffer.data));
        return context;
    }

    async request(options: RequestOptions): Promise<RequestContext> {
        await this.preferenceService.ready;
        const backendResult = await this.backendRequestService.request(options);
        return this.transformBackendResponse(backendResult);
    }
}

@injectable()
export class XHRBrowserRequestService extends DefaultBrowserRequestService {

    protected authorization?: string;

    configure(config: RequestConfiguration): void {
        if ('proxyAuthorization' in config) {
            this.authorization = config.proxyAuthorization;
        }
        super.configure(config);
    }

    async request(options: RequestOptions, token = CancellationToken.None): Promise<RequestContext> {
        try {
            const xhrResult = await this.xhrRequest(options, token);
            if (xhrResult.res.statusCode === 405) {
                return super.request(options);
            }
            return xhrResult;
        } catch {
            return super.request(options);
        }
    }

    protected xhrRequest(options: RequestOptions, token: CancellationToken): Promise<RequestContext> {
        const authorization = this.authorization || options.proxyAuthorization;
        if (authorization) {
            options.headers = {
                ...(options.headers || {}),
                'Proxy-Authorization': authorization
            };
        }

        const xhr = new XMLHttpRequest();
        return new Promise<RequestContext>((resolve, reject) => {

            xhr.open(options.type || 'GET', options.url || '', true, options.user, options.password);
            this.setRequestHeaders(xhr, options);

            xhr.responseType = 'arraybuffer';
            xhr.onerror = () => reject(new Error(xhr.statusText && ('XHR failed: ' + xhr.statusText) || 'XHR failed'));
            xhr.onload = () => {
                resolve({
                    res: {
                        statusCode: xhr.status,
                        headers: this.getResponseHeaders(xhr)
                    },
                    buffer: BinaryBuffer.wrap(new Uint8Array(xhr.response))
                });
            };
            xhr.ontimeout = e => reject(new Error(`XHR timeout: ${options.timeout}ms`));

            if (options.timeout) {
                xhr.timeout = options.timeout;
            }

            xhr.send(options.data);

            // cancel
            token.onCancellationRequested(() => {
                xhr.abort();
                reject();
            });
        });
    }

    protected setRequestHeaders(xhr: XMLHttpRequest, options: RequestOptions): void {
        if (options.headers) {
            outer: for (const k of Object.keys(options.headers)) {
                switch (k) {
                    case 'User-Agent':
                    case 'Accept-Encoding':
                    case 'Content-Length':
                        // unsafe headers
                        continue outer;
                }
                xhr.setRequestHeader(k, options.headers[k]);
            }
        }
    }

    protected getResponseHeaders(xhr: XMLHttpRequest): { [name: string]: string } {
        const headers: { [name: string]: string } = {};
        for (const line of xhr.getAllResponseHeaders().split(/\r\n|\n|\r/g)) {
            if (line) {
                const idx = line.indexOf(':');
                headers[line.substr(0, idx).trim().toLowerCase()] = line.substr(idx + 1).trim();
            }
        }
        return headers;
    }
}
