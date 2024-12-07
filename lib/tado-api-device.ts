import { OAuth2Device } from "homey-oauth2app";
import { HomeyIntervalManager, IntervalConfiguration, IntervalConfigurationCollection } from "homey-interval-manager";
import { TadoApiClient, TadoXApiClient } from "./tado-api-client";
import { TadoOAuth2Client } from "./tado-oauth2-client";
import { HomeGeneration } from "node-tado-client";

type DeviceSettingsValue = boolean | string | number | undefined | null;
type DeviceSettings = Record<string, DeviceSettingsValue>;

export abstract class TadoApiDevice extends OAuth2Device<TadoOAuth2Client> {
    protected intervalManager!: HomeyIntervalManager<this>;
    protected initialised: boolean = false;

    protected abstract get intervalConfigs(): IntervalConfigurationCollection<this>;

    protected get generation(): HomeGeneration {
        const generation = this.getData()?.generation ?? this.getStoreValue("generation");
        return (generation ? generation : undefined) ?? "UNKNOWN";
    }

    protected get isGenerationX(): boolean {
        return this.generation === "LINE_X";
    }

    protected get api(): TadoApiClient | TadoXApiClient {
        return this.generation === "PRE_LINE_X" ? this.api_v2 : this.api_x;
    }

    protected get api_v2(): TadoApiClient {
        return this.oAuth2Client.tado;
    }

    protected get api_x(): TadoXApiClient {
        return this.oAuth2Client.tadox;
    }

    /**
     * Generates a date string in the format 'YYYY-MM-DD' or 'YYYY-MM' if the month flag is true.
     *
     * @param date Optional date object. If null, the current date is used.
     * @param month Flag indicating whether to exclude the day component, returning 'YYYY-MM'.
     * @return Formatted date string.
     */
    public dateString(date: Date | null = null, month: boolean = false): string {
        const source = date ?? new Date();
        const parts = [
            String(source.getFullYear()),
            String(source.getMonth() + 1).padStart(2, "0"),
            ...(month ? [] : [String(source.getDate()).padStart(2, "0")]),
        ];
        return parts.join("-");
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
     * Migrates the generation data for a given home if the current generation is unknown.
     *
     * This method retrieves the home information from the API and sets the generation value in the store
     * if the current generation is identified as "UNKNOWN".
     *
     * @param home_id - The unique identifier of the home whose generation data is to be migrated.
     * @returns A promise that resolves when the migration is complete.
     */
    protected async migrateGeneration(home_id: number): Promise<void> {
        if (this.generation === "UNKNOWN") {
            // Homey does not like changing data values so we let older devices use store
            await this.api
                .getHome(home_id)
                .then(async (home_info) => {
                    await this.setStoreValue("generation", home_info.generation).catch(this.error);
                })
                .catch(this.error);
        }
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

        this.intervalManager = new HomeyIntervalManager(this, this.intervalConfigs, 600, true);

        // perform common actions
        await this.migrate();
        await this.start();

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
