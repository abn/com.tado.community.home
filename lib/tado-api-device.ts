import { OAuth2Device } from "homey-oauth2app";
import { HomeyIntervalManager, IntervalConfiguration, IntervalConfigurationCollection } from "homey-interval-manager";
import { TadoApiClient } from "./tado-api-client";
import { TadoOAuth2Client } from "./tado-oauth2-client";

type DeviceSettingsValue = boolean | string | number | undefined | null;
type DeviceSettings = Record<string, DeviceSettingsValue>;

export abstract class TadoApiDevice extends OAuth2Device<TadoOAuth2Client> {
    protected intervalManager!: HomeyIntervalManager<this>;
    protected initialised: boolean = false;

    protected abstract get intervalConfigs(): IntervalConfigurationCollection<this>;

    protected get api(): TadoApiClient {
        return this.oAuth2Client.tado;
    }

    /**
     * ------------------------------------------------------------------
     * Migration Helpers
     * ------------------------------------------------------------------
     */

    protected async migrateRemoveCapabilities(...capabilities: string[]): Promise<void> {
        capabilities.map(async (capability) => {
            if (this.hasCapability(capability)) await this.removeCapability(capability).catch(this.error);
        });
    }

    protected async migrateAddCapabilities(...capabilities: string[]): Promise<void> {
        capabilities.map(async (capability) => {
            if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
        });
    }

    protected async migrate(): Promise<void> {
        // this method can be overridden
        return;
    }

    /**
     * ------------------------------------------------------------------
     * Lifecycle Helpers
     * ------------------------------------------------------------------
     */

    protected async start(): Promise<void> {
        // this method can be overridden
        return;
    }

    protected async stop(): Promise<void> {
        // this method can be overridden
        return;
    }

    /**
     * ------------------------------------------------------------------
     * Event Handlers
     * ------------------------------------------------------------------
     */

    override async onOAuth2Init(): Promise<void> {
        this.log("tado° API device initialized");

        // perform common actions
        await this.migrate();
        await this.start();

        this.intervalManager = new HomeyIntervalManager(this, this.intervalConfigs, 600, true);
        await this.intervalManager.start();

        this.initialised = true;
    }

    override async onOAuth2Uninit(): Promise<void> {
        this.log("tado° API device uninitialized");

        // perform common actions
        await this.intervalManager.stop();

        await this.stop();
    }

    /**
     * onSettings is called when the user updates the device's settings.
     *
     * @param event The onSettings event data
     * @returns Promise<string|void> Return a custom message that will be displayed
     */
    override async onSettings(event: {
        oldSettings: DeviceSettings;
        newSettings: DeviceSettings;
        changedKeys: string[];
    }): Promise<string | void> {
        this.log("tado° API device settings where changed");
        const changedKeys = event.changedKeys as IntervalConfiguration<this>["settingName"][] & string[];
        this.homey.setTimeout(async () => {
            await this.intervalManager.restartBySettings(...changedKeys);
        }, 1000);
    }

    /**
     * ------------------------------------------------------------------
     * Device Event Management
     * ------------------------------------------------------------------
     */

    override async onOAuth2Deleted(): Promise<void> {}
}
