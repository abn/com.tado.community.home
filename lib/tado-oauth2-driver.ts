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
        let cancelled = false;

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

            const devices = await client.withUserInitiatedRequests(() =>
                this.onPairListDevices({
                    oAuth2Client: client,
                }),
            );

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

        session.setHandler("cancel", async () => {
            cancelled = true;
        });

        session.setHandler("disconnect", async () => {
            cancelled = true;
            this.log("Pair Session Disconnected");
        });

        session.setHandler("showView", async (viewId) => {
            currentViewId = viewId;
            if (viewId !== "tado_device_auth") return;

            // An existing account already has a session. Check that it can
            // still be used and go straight to its devices; otherwise fall
            // through and authorize the account again.
            if (OAuth2SessionId !== "$new") {
                try {
                    await client.withUserInitiatedRequests(() => client.tado.getMe());
                    if (cancelled) return;
                    await session.nextView().catch(this.error);
                    return;
                } catch (err) {
                    if (cancelled) return;

                    const message = err instanceof Error ? err.message : String(err);
                    const status = this.errorStatus(err);
                    const authFailure =
                        this.isRefreshTokenExpired(err) ||
                        status === 401 ||
                        status === 403 ||
                        /invalid_grant|refresh.?token.*(invalid|expired|revoked)/i.test(message);

                    if (!authFailure) {
                        await this.reportPairingError(session, client, err);
                        return;
                    }

                    this.log("Saved tado° session is no longer usable, re-authorizing", err);
                    OAuth2SessionId = "$new";
                    client = this.homey.app.createOAuth2Client({
                        sessionId: OAuth2Util.getRandomId(),
                        configId: OAuth2ConfigId,
                    });
                }
            }

            try {
                const token = await client.getTokenByDeviceAuth(session);
                if (cancelled) {
                    client.destroy();
                    return;
                }

                const { id, email } = await client.withUserInitiatedRequests(() => client.tado.getMe());
                if (cancelled) {
                    client.destroy();
                    return;
                }

                OAuth2SessionId = id;

                // Destroy the temporary client
                client.destroy();

                // Replace the temporary client by the final one, reusing it
                // when this account is already connected.
                client = this.homey.app.hasOAuth2Client({ sessionId: id, configId: OAuth2ConfigId })
                    ? this.homey.app.getOAuth2Client({ sessionId: id, configId: OAuth2ConfigId })
                    : this.homey.app.createOAuth2Client({ sessionId: id, configId: OAuth2ConfigId });
                client.setTitle({ title: email });
                client.setToken({ token });

                await session.emit("authorized", {}).catch(this.error);
                await session.nextView().catch(this.error);
            } catch (err) {
                if (cancelled) return;

                await this.reportPairingError(session, client, err);
            }
        });
    }

    private errorStatus(err: unknown): number | undefined {
        if (typeof err !== "object" || err === null || !("status" in err)) return undefined;

        const status = Number((err as { status?: unknown }).status);
        return Number.isNaN(status) ? undefined : status;
    }

    private isRefreshTokenExpired(err: unknown): boolean {
        return (
            typeof err === "object" &&
            err !== null &&
            (err as { refreshTokenExpired?: boolean }).refreshTokenExpired === true
        );
    }

    /**
     * Turns a pairing failure into something the pair view can show.
     */
    private describePairingError(client: TadoOAuth2Client, err: unknown): string {
        const status = this.errorStatus(err);
        const message = err instanceof Error ? err.message : String(err);
        const allowance = client.requestAllowance;
        const reset = allowance.exhausted
            ? ` It resets in about ${Math.max(1, Math.ceil(allowance.resetsInSeconds / 60))} minutes.`
            : "";

        if (status === 401 || status === 403) {
            return "tado° rejected the account authorization. Please try again.";
        }
        if (status === 429 || /rate limited/i.test(message)) {
            return `tado° is refusing requests because its daily request allowance is spent.${reset} Please try again after that.`;
        }
        if (allowance.exhausted && /allowance/i.test(message)) {
            return `tado°'s request allowance for today is spent.${reset} Please try again after that.`;
        }

        return `Could not finish linking the tado° account: ${message}`;
    }

    private async reportPairingError(session: PairSession, client: TadoOAuth2Client, err: unknown): Promise<void> {
        this.error("Failed to authenticate Tado:", err);
        await session.emit("error", { message: this.describePairingError(client, err) }).catch(this.error);
    }

    override async onRepair(session: PairSession, device: TadoApiDevice): Promise<void> {
        let client: TadoOAuth2Client;
        let cancelled = false;

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
            if (viewId !== "tado_device_auth") return;

            let deviceStopped = false;
            try {
                await client.getTokenByDeviceAuth(session);
                if (cancelled) {
                    client.save();
                    return;
                }

                deviceStopped = true;
                await device.onOAuth2Uninit();

                await device.setStoreValue("OAuth2SessionId", OAuth2SessionId);
                await device.setStoreValue("OAuth2ConfigId", OAuth2ConfigId);

                client.save();

                device.oAuth2Client = client;
                await device.onOAuth2Init();
                deviceStopped = false;

                await device.setAvailable().catch(this.error);
            } catch (err) {
                if (deviceStopped) {
                    let recovered = false;
                    device.oAuth2Client = client;
                    await device
                        .onOAuth2Init()
                        .then(() => {
                            recovered = true;
                        })
                        .catch(this.error);

                    if (recovered) await device.setAvailable().catch(this.error);
                }

                if (cancelled) return;

                await this.reportPairingError(session, client, err);
                return;
            }

            await session.emit("authorized", {}).catch(this.error);
            await session.done().catch(this.error);
        });

        session.setHandler("cancel", async (): Promise<void> => {
            cancelled = true;
        });

        session.setHandler("disconnect", async (): Promise<void> => {
            cancelled = true;
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
