import { OAuth2App } from "homey-oauth2app";
import { TadoOAuth2Client } from "./lib/tado-oauth2-client";

module.exports = class TadoHomeApp extends OAuth2App<TadoOAuth2Client> {
    static override OAUTH2_CLIENT = TadoOAuth2Client;
    static override OAUTH2_DEBUG = false;
    static override OAUTH2_MULTI_SESSION = false;

    override async onOAuth2Init(): Promise<void> {
        await this.migrate().catch(this.error);
        this.log("tado° Home Manager has been initialized");
    }

    private async migrate(): Promise<void> {
        const migration_status = this.homey.settings.get("migration_status") || {};

        // this is a wrapper handle migration execution
        const migration = async (key: string, message: string, method: () => Promise<void>): Promise<void> => {
            if (!(migration_status[key] ?? false)) {
                this.log(`Migration (${key}): ${message}`);
                await method()
                    .then(() => {
                        migration_status[key] = true;
                        this.log(`Migration (${key}): completed`);
                    })
                    .catch(this.error);
            }
        };

        await migration("session_title", "Handle OAuth2 session tile changes", async () => {
            const saved_sessions = this.getSavedOAuth2Sessions();

            for (const session_id in saved_sessions) {
                try {
                    saved_sessions[session_id].title = JSON.parse(saved_sessions[session_id].title).email;
                } catch (_error) {
                    // ignore this as this is due to the title not being a valid json string
                }
            }

            // this key might change as it is not exported
            this.homey.settings.set("OAuth2Sessions", saved_sessions);
        });

        this.homey.settings.set("migration_status", migration_status);
    }
};
