import { fetch, OAuth2Client, OAuth2Error, OAuth2Token } from "homey-oauth2app";
import { TadoApiClient, TadoXApiClient } from "./tado-api-client";

type AllowedMethods = "get" | "post" | "put" | "delete";
type PayloadMethods = "post" | "put";

export class TadoOAuth2Client extends OAuth2Client<OAuth2Token> {
    // Required:
    static override API_URL = "https://my.tado.com/api/v2";
    static override TOKEN_URL = "https://auth.tado.com/oauth/token";
    static override AUTHORIZATION_URL = "https://auth.tado.com/oauth/authorize";
    // static override SCOPES = ["home"];

    // source: https://support.tado.com/en/articles/8565472-how-do-i-update-my-rest-api-authentication-method-to-oauth-2
    static override CLIENT_ID = "public-api-preview";
    static override CLIENT_SECRET = "4HJGRffVR8xb3XdEUQpjgZ1VplJi6Xgw";

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
            // workaround missing event dispatch in homey-oauth2app, this is required to set device as unavailable
            let refresh_token_expired = [400, 401, 403].includes(response.status);

            if (!refresh_token_expired && error instanceof OAuth2Error) {
                const error_message = error.toString();
                const substrings = /invalid_grant|Invalid refresh token|Refresh token revoked|expired/;
                refresh_token_expired = substrings.test(error_message);
            }

            if (refresh_token_expired) {
                this.log("Refresh token has expired, please re-authenticate");
                this.emit("expired");
            }

            throw error;
        }

        // this should never be hit
        throw new OAuth2Error("Failed to refresh token");
    }
}
