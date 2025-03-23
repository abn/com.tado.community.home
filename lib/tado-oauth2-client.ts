import { fetch, OAuth2Client, OAuth2Error, OAuth2Token } from "homey-oauth2app";
import { TadoApiClient, TadoXApiClient } from "./tado-api-client";
import PairSession from "homey/lib/PairSession";

type AllowedMethods = "get" | "post" | "put" | "delete";
type PayloadMethods = "post" | "put";

export class TadoOAuth2Client extends OAuth2Client<OAuth2Token> {
    // Required:
    static override API_URL = "https://my.tado.com/api/v2";
    static override TOKEN_URL = "https://login.tado.com/oauth2/token";
    static override AUTHORIZATION_URL = ""; // Not used with device code flow
    static override SCOPES = ["offline_access"];

    // source: https://support.tado.com/en/articles/8565472-how-do-i-authenticate-to-access-the-rest-api
    static override CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
    static override CLIENT_SECRET = ""; // Not needed for device code flow

    public readonly tado: TadoApiClient = new TadoApiClient();
    public readonly tadox: TadoXApiClient = new TadoXApiClient();

    /**
     * Monkey patch method to replace `TadoApiClient.apiCall()` in order to use the authenticated session from `OAuth2Client`.
     */
    async _apiCall<T, M extends AllowedMethods>(
        url: string,
        method: keyof this & AllowedMethods = "get",
        data?: M extends PayloadMethods ? unknown : never,
    ): Promise<T> {
        return this[method.toLowerCase() as AllowedMethods]({
            path: url.replace("/api/v2", ""),
            json: data,
        });
    }

    override async onInit(): Promise<void> {
        // monkey patch tado instances, this only works with `onInit`
        this.tado.apiCall = this._apiCall.bind(this);
        this.tadox.apiCall = this._apiCall.bind(this);
    }

    /**
     * Getting session information for use with multi-session support.
     */
    override async onGetOAuth2SessionInformation(): Promise<{ id: string; title: string | null }> {
        // this might require a refreshed token
        const me = await this.tado.getMe();

        return {
            id: me.id,
            title: me.email,
        };
    }

    override async onHandleRefreshTokenError({ response }: { response: fetch.Response }): Promise<never> {
        try {
            await super.onHandleRefreshTokenError({ response });
        } catch (error) {
            // re-process the error to determine if the refresh token has expired
            // we unfortunately need to do this because the `homey-oauth2app` does not emit an event for this
            // not does it store the parsed payload
            let refresh_token_expired = false;

            await response
                .json()
                .then((json: { error?: string }) => {
                    refresh_token_expired = json.error === "invalid_grant";
                })
                .catch(() => {});

            if (!refresh_token_expired) {
                // we cannot parse the response as json, try fallback
                refresh_token_expired = [400, 401].includes(response.status);

                if (!refresh_token_expired && error instanceof OAuth2Error) {
                    const error_message = error.toString();
                    const substrings = /invalid_grant|invalid refresh token|refresh token revoked|expired/i;
                    refresh_token_expired = substrings.test(error_message);
                }
            }

            if (refresh_token_expired) {
                this.log("Refresh token has expired, please re-authenticate");
                this.emit("expired");
            } else {
                this.log(`Attempt to refresh token failed with status ${response.status}`);
            }

            throw error;
        }

        // this should never be hit
        throw new OAuth2Error("Failed to refresh token");
    }

    /**
     * Authenticates a device using a tado client and retrieves an OAuth2 token.
     *
     * @param {PairSession} session - The pairing session instance used to emit authorization and completion events.
     * @return {Promise<OAuth2Token>} Returns a promise resolving to an OAuth2 token containing access token, refresh token, and expiration details.
     */
    async getTokenByDeviceAuth(session: PairSession): Promise<OAuth2Token> {
        const [verify, futureToken] = await this.tado.authenticate("refreshToken");

        if (verify) {
            const authorizationUrl = verify.verification_uri_complete;
            await session.emit("url", authorizationUrl);
        }
        const tadoToken = await futureToken;

        await session.emit("tado_authorization_completed", {}).catch(this.error);

        const token = new OAuth2Token({
            access_token: tadoToken.access_token,
            refresh_token: tadoToken.refresh_token,
            expires_in: Math.floor((tadoToken.expiry.getTime() - Date.now()) / 1000),
        });

        this.setToken({ token });

        return token;
    }
}
