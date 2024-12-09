/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "homey-oauth2app" {
    import Homey, { SimpleClass } from "homey";
    import { Log } from "homey-log";
    import PairSession from "homey/lib/PairSession";
    export { fetch } from "node-fetch";

    export class OAuth2App<T extends OAuth2Client> extends Homey.App {
        static OAUTH2_CLIENT: T;
        static OAUTH2_DEBUG: boolean;
        static OAUTH2_MULTI_SESSION: boolean;

        onOAuth2Init(): Promise<void>;

        getFirstSavedOAuth2Client(): OAuth2Client;

        getSavedOAuth2Sessions(): { [key: string]: { configId: string; title: string; token?: object } };

        homeyLog: Log;
    }

    export class OAuth2Client<TToken extends OAuth2Token> extends SimpleClass {
        static API_URL: string;
        static TOKEN_URL: string;
        static AUTHORIZATION_URL: string;
        static SCOPES: string[];
        static CLIENT_ID: string;
        static CLIENT_SECRET: string;

        _token?: TToken;
        _clientId!: string;
        _clientSecret!: string;

        homey: Homey;

        get<T>(data: { path: string; query?: any; headers?: any }): Promise<T>;

        delete<T>(data: { path: string; query?: any; headers?: any }): Promise<T>;

        post<T>(data: { path: string; query?: any; json?: any; body?: any; headers?: any }): Promise<T>;

        put<T>(data: { path: string; query?: any; json?: any; body?: any; headers?: any }): Promise<T>;

        onShouldRefreshToken(args: { status: number }): Promise<boolean>;

        getToken(): TToken;

        async refreshToken(...args): Promise<void>;

        save(): void;

        async onBuildRequest(args: {
            method: string;
            path: string;
            json: object;
            body: object;
            query: object;
            headers: object;
        }): Promise<{
            opts: {
                method: unknown;
                body: unknown;
                headers: object;
            };
            url: string;
        }>;

        async onGetOAuth2SessionInformation(): Promise<{ id: *; title: string | null }>;
    }

    export class OAuth2Device<T extends OAuth2Client> extends Homey.Device {
        oAuth2Client: T;

        onOAuth2Init(): Promise<void>;

        onOAuth2Uninit(): Promise<void>;

        onOAuth2Added(): Promise<void>;

        onOAuth2Deleted(): Promise<void>;

        homey: Homey;
    }

    export class OAuth2Driver<T extends OAuth2Client> extends Homey.Driver {
        onOAuth2Init(): Promise<void>;

        onPairListDevices(payload: { oAuth2Client: T }): Promise<OAuth2DeviceResult[]>;

        onRepair(socket: PairSession, device: Homey.Device): void;

        homey: Homey;
    }

    export interface OAuth2DeviceResult {
        name: string;
        data: {
            [key: string]: any;
        };
        store?: {
            [key: string]: any;
        };
        settings?: {
            [key: string]: any;
        };
        icon?: string;
        capabilities?: string[];
        capabilitiesOptions?: {
            [key: string]: {
                [key: string]: any;
            };
        };
    }

    export class OAuth2Token {
        access_token: string;
        refresh_token: string;
        token_type?: string;
        expires_in?: number;

        constructor(param: { access_token: string; refresh_token: string; token_type?: string; expires_in?: number });

        isRefreshable(): boolean;

        toJSON(): {
            access_token: string;
            refresh_token: string;
            token_type?: string;
            expires_in?: number;
        };
    }

    export class OAuth2Error {
        constructor(message: string, statusCode?: number);
    }
}
