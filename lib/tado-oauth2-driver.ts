import { OAuth2Driver } from "homey-oauth2app";
import { TadoOAuth2Client } from "./tado-oauth2-client";
import type PairSession from "homey/lib/PairSession";

export class TadoOAuth2Driver extends OAuth2Driver<TadoOAuth2Client> {
    override async onPair(session: PairSession): Promise<void> {
        await super.onPair(session);
    }

    async registerActionFlows(): Promise<void> {}

    override async onOAuth2Init(): Promise<void> {
        await super.onOAuth2Init();
        await this.registerActionFlows().catch(this.error);
    }
}
