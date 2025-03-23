import { OAuth2Driver, OAuth2Util } from "homey-oauth2app";
import { TadoOAuth2Client } from "./tado-oauth2-client";
import type PairSession from "homey/lib/PairSession";
import { TadoApiDevice } from "./tado-api-device";

export class TadoOAuth2Driver extends OAuth2Driver<TadoOAuth2Client> {
    override async onPair(session: PairSession): Promise<void> {
        const OAuth2ConfigId = this.getOAuth2ConfigId();
        let OAuth2SessionId = "$new";

        let client: TadoOAuth2Client = this.homey.app.createOAuth2Client({
            sessionId: OAuth2Util.getRandomId(),
            configId: OAuth2ConfigId,
        });

        let currentViewId = "list_sessions";

        const onListSessions = async (): Promise<{ name: string; data: { id: string }; icon: null }[]> => {
            const savedSessions = this.homey.app.getSavedOAuth2Sessions();
            const result = Object.keys(savedSessions).map((sessionId, i) => {
                const session = savedSessions[sessionId];
                return {
                    name: session.title || `Saved User ${i + 1}`,
                    data: { id: sessionId },
                    icon: null,
                };
            });

            result.push({
                name: TadoOAuth2Driver.OAUTH2_NEW_SESSION_TITLE,
                icon: TadoOAuth2Driver.OAUTH2_NEW_SESSION_ICON,
                data: {
                    id: "$new",
                },
            });

            return result;
        };

        session.setHandler("list_sessions", onListSessions);

        session.setHandler("list_sessions_selection", async ([selection]) => {
            const { id } = selection.data;

            OAuth2SessionId = id;
            this.log(`Selected session ${OAuth2SessionId}`);

            if (OAuth2SessionId === "$new") {
                client = this.homey.app.createOAuth2Client({
                    configId: OAuth2ConfigId,
                    sessionId: OAuth2Util.getRandomId(),
                });
            } else {
                client = this.homey.app.getOAuth2Client({
                    configId: OAuth2ConfigId,
                    sessionId: OAuth2SessionId,
                });
            }
        });

        session.setHandler("list_devices", async () => {
            if (currentViewId === "list_sessions") {
                return onListSessions();
            }

            const devices = await this.onPairListDevices({
                oAuth2Client: client,
            });

            return devices.map((device) => {
                return {
                    ...device,
                    store: {
                        ...device.store,
                        OAuth2SessionId,
                        OAuth2ConfigId,
                    },
                };
            });
        });

        session.setHandler("add_device", async () => {
            this.log("At least one device has been added, saving the client...");
            client.save();
        });

        session.setHandler("disconnect", async () => {
            this.log("Pair Session Disconnected");
        });

        session.setHandler("showView", async (viewId) => {
            currentViewId = viewId;
            if (viewId === "tado_device_auth") {
                if (OAuth2SessionId !== "$new") {
                    session.nextView().catch(this.error);
                }

                try {
                    const sessionWasNew = OAuth2SessionId === "$new";
                    const token = await client.getTokenByDeviceAuth(session);
                    const { id, email } = await client.tado.getMe();

                    OAuth2SessionId = id;

                    if (sessionWasNew) {
                        // Destroy the temporary client
                        client.destroy();

                        // Replace the temporary client by the final one
                        client = this.homey.app.createOAuth2Client({
                            sessionId: id,
                            configId: OAuth2ConfigId,
                        });
                    }

                    client.setTitle({ title: email });
                    client.setToken({ token });

                    await session.emit("authorized", {}).catch(this.error);
                    await session.nextView().catch(this.error);
                } catch (err) {
                    this.error("Failed to authenticate Tado:", err);
                    await session.emit("error", err);
                }
            }
        });
    }

    override async onRepair(session: PairSession, device: TadoApiDevice): Promise<void> {
        let client: TadoOAuth2Client;

        let { OAuth2SessionId, OAuth2ConfigId } = device.getStore();

        if (!OAuth2SessionId) {
            OAuth2SessionId = OAuth2Util.getRandomId();
        }

        if (!OAuth2ConfigId) {
            OAuth2ConfigId = this.getOAuth2ConfigId();
        }

        // Get the Device's OAuth2Client
        // Or create it when it doesn't exist
        try {
            client = this.homey.app.getOAuth2Client({
                sessionId: OAuth2SessionId,
                configId: OAuth2ConfigId,
            });
        } catch (_: unknown) {
            client = this.homey.app.createOAuth2Client({
                sessionId: OAuth2SessionId,
                configId: OAuth2ConfigId,
            });
        }

        session.setHandler("showView", async (viewId: string): Promise<void> => {
            if (viewId === "tado_device_auth") {
                await client.getTokenByDeviceAuth(session);

                await device.onOAuth2Uninit();
                await device.setStoreValue("OAuth2SessionId", OAuth2SessionId);
                await device.setStoreValue("OAuth2ConfigId", OAuth2ConfigId);

                client.save();

                device.oAuth2Client = client;
                await device.onOAuth2Init();

                session.nextView().catch(this.error);
            }
        });

        session.setHandler("disconnect", async (): Promise<void> => {
            this.log("Pair Session Disconnected");
        });
    }

    async registerActionFlows(): Promise<void> {}

    async registerConditionFlows(): Promise<void> {}

    override async onOAuth2Init(): Promise<void> {
        await super.onOAuth2Init();
        await this.registerActionFlows().catch(this.error);
        await this.registerConditionFlows().catch(this.error);
    }
}
