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

import { CancellationToken } from 'vscode-languageserver-protocol';
import { BinaryBuffer } from './buffer';

export interface Headers {
    [header: string]: string;
}

export interface RequestOptions {
    type?: string;
    url: string;
    user?: string;
    password?: string;
    headers?: Headers;
    timeout?: number;
    data?: string;
    followRedirects?: number;
    proxyAuthorization?: string;
}

export interface RequestContext {
    res: {
        headers: Headers;
        statusCode?: number;
    };
    buffer: BinaryBuffer;
}

export namespace RequestContext {
    export function isSuccess(context: RequestContext): boolean {
        return (context.res.statusCode && context.res.statusCode >= 200 && context.res.statusCode < 300) || context.res.statusCode === 1223;
    }

    function hasNoContent(context: RequestContext): boolean {
        return context.res.statusCode === 204;
    }

    export async function asText(context: RequestContext): Promise<string> {
        if (!isSuccess(context)) {
            throw new Error('Server returned ' + context.res.statusCode);
        }
        if (hasNoContent(context)) {
            return '';
        }
        return context.buffer.toString();
    }

    export async function asJson<T = {}>(context: RequestContext): Promise<T> {
        if (!isSuccess(context)) {
            throw new Error('Server returned ' + context.res.statusCode);
        }
        const str = context.buffer.toString();
        try {
            return JSON.parse(str);
        } catch (err) {
            err.message += ':\n' + str;
            throw err;
        }
    }
}

export interface RequestConfiguration {
    proxyUrl?: string;
    proxyAuthorization?: string;
    strictSSL?: boolean;
}

export const RequestService = Symbol('RequestService');
export const BackendRequestService = Symbol('BackendRequestService');
export const REQUEST_SERVICE_PATH = '/services/request-service';

export interface RequestService {
    configure(config: RequestConfiguration): void;
    request(options: RequestOptions, token?: CancellationToken): Promise<RequestContext>;
    resolveProxy(url: string): Promise<string | undefined>
}
