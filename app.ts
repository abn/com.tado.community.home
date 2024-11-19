import { OAuth2App } from "homey-oauth2app";
import { TadoOAuth2Client } from "./lib/tado-oauth2-client";

module.exports = class TadoHomeApp extends OAuth2App<TadoOAuth2Client> {
    static override OAUTH2_CLIENT = TadoOAuth2Client;
    static override OAUTH2_DEBUG = false;
    static override OAUTH2_MULTI_SESSION = false;

    override async onOAuth2Init(): Promise<void> {
        this.log("tado° Home Manager has been initialized");
    }
};
