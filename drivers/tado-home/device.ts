import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { EnergyIQConsumptionDetails, State, StatePresence, TadoMode } from "node-tado-client";

module.exports = class TadoHomeDevice extends TadoApiDevice {
    private get id(): number {
        return this.getData().id;
    }

    protected override get intervalConfigs(): IntervalConfigurationCollection<TadoHomeDevice> {
        return {
            GEOFENCING_MODE: {
                functionName: "syncGeofencingMode",
                settingName: "geofencing_mode_polling_interval",
            },
            HOME_INFO: {
                functionName: "syncHomeInfo",
                settingName: "home_info_polling_interval",
            },
            GAS_METER_READING: {
                functionName: "syncGasMeterReading",
                settingName: "gas_meter_reading_polling_interval",
                disableAutoStart: true,
            },
            ENERGY_CONSUMPTION: {
                functionName: "syncEnergyConsumption",
                settingName: "energy_consumption_polling_interval",
                disableAutoStart: true,
            },
            WEATHER_STATE: {
                functionName: "syncWeather",
                intervalSeconds: 3600, // 1 hour
            },
        };
    }

    async registerActionFlows(): Promise<void> {
        const meterReadingReportAction = this.homey.flow.getActionCard("meter_reading_report");
        meterReadingReportAction.registerRunListener(
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            async (args: { date?: string; reading: number }, state: unknown) => {
                await this.api.addEnergyIQMeterReading(this.id, this.formatFlowArgDate(args.date), args.reading);
            },
        );

        const resumeScheduleAction = this.homey.flow.getActionCard("tado_home_resume_schedule");
        resumeScheduleAction.registerRunListener(async () => {
            await this.resumeSchedule();
        });

        const boostHeatingAction = this.homey.flow.getActionCard("tado_home_boost_heating");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        boostHeatingAction.registerRunListener(async (args: { duration?: number }, state: unknown) => {
            await this.boostHeating({ durationSeconds: args.duration ? args.duration / 1000 : 1800 });
        });
    }

    protected override async start(): Promise<void> {
        if (this.initialised) return;

        this.registerCapabilityListener("tado_geofencing_mode", async (value: StatePresence) => {
            await this.setGeofencingMode(value);
        });

        this.registerCapabilityListener("tado_resume_schedule", async (value) => {
            if (value) await this.resumeSchedule();
        });

        this.registerCapabilityListener("button.restart_polling", async () => {
            await this.intervalManager.restart();
        });

        await this.registerActionFlows().catch(this.error);
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {}

    /**
     * Formats a string date in DD-MM-YYYY format to a standardized date string usable by tado
     * in the format YYYY-MM-DD. This is useful for handling Homey's #Date tag input.
     *
     * @param date - The date string in DD-MM-YYYY format, defaults to today.
     * @return The formatted date string.
     */
    private formatFlowArgDate(date?: string | undefined): string {
        if (!date) return this.api.dateString();

        const datePattern = /^\d{2}-\d{2}-\d{4}$/;
        if (!datePattern.test(date.trim())) {
            throw new Error("Invalid date format. Please use DD-MM-YYYY.");
        }

        const [day, month, year] = date.trim().split("-").map(Number);

        return this.api.dateString(new Date(year, month - 1, day));
    }

    private async setTadoPresenceMode(value: TadoMode): Promise<void> {
        await this.setCapabilityValue("tado_presence_mode", value.toLowerCase());
    }

    private async getCurrentHomeState(): Promise<State> {
        const state = await this.api.getState(this.id);
        await this.setTadoPresenceMode(state.presence as TadoMode);
        return state;
    }

    /**
     * ------------------------------------------------------------------
     * Geofencing Mode Management
     * ------------------------------------------------------------------
     */

    private async getCurrentGeofencingMode(): Promise<string> {
        const state = await this.getCurrentHomeState();
        const isAutoAssistEnabled = this.isAutoAssistEnabled();

        // this allows for non auto assist enabled users to rely on mobile device locations
        await this.setCapabilityValue(
            "tado_is_anyone_home",
            isAutoAssistEnabled ? state.presence.toLowerCase() == "home" : await this.api.isAnyoneAtHome(this.id),
        );

        return state.presenceLocked || !isAutoAssistEnabled ? state.presence.toLowerCase() : "auto";
    }

    public async syncGeofencingMode(): Promise<void> {
        const mode = await this.getCurrentGeofencingMode();
        await this.setCapabilityValue("tado_geofencing_mode", mode);
    }

    private async setGeofencingMode(value: StatePresence): Promise<void> {
        const state = value.toUpperCase() as StatePresence;

        if (state == "AUTO" && !this.isAutoAssistEnabled()) {
            throw new Error("Auto Assist is not enabled");
        }
        await this.api.setPresence(this.id, state);

        // Update geofencing mode after a short delay
        this.homey.setTimeout(async () => {
            await this.syncGeofencingMode();
        }, 1000);
    }

    /**
     * ------------------------------------------------------------------
     * Home Info Management
     * ------------------------------------------------------------------
     */

    private isAutoAssistEnabled(): boolean {
        return this.getSetting("auto_assist_enabled") == "Yes";
    }

    private async configureEnergyIQCapabilities(isEnabled: boolean): Promise<void> {
        const intervalKeys = ["GAS_METER_READING", "ENERGY_CONSUMPTION"];

        // disable intervals
        if (!isEnabled) {
            intervalKeys.map(async (intervalKey) => {
                await this.intervalManager.stop(intervalKey);
            });
        }

        const energyIQCapabilities = [
            "meter_gas",
            "meter_power.daily_consumption",
            "meter_power.daily_consumption_average",
            "meter_power.monthly_consumption",
        ];

        for (const capability of energyIQCapabilities) {
            const isCapabilityActive = this.hasCapability(capability);

            if (isEnabled && !isCapabilityActive) {
                await this.addCapability(capability);
            } else if (!isEnabled && isCapabilityActive) {
                await this.removeCapability(capability);
            }
        }

        if (isEnabled) {
            intervalKeys.map(async (intervalKey) => {
                if (!this.intervalManager.isActive(intervalKey)) {
                    this.homey.setTimeout(async () => {
                        await this.intervalManager.start(intervalKey);
                    }, 5 * 1000);
                }
            });
        }
    }

    private async configureAutoAssist(isEnabled: boolean): Promise<void> {
        await this.setSettings({
            auto_assist_enabled: isEnabled ? "Yes" : "No",
        });

        await this.configureEnergyIQCapabilities(isEnabled);
        await this.setCapabilityValue("tado_geofencing_mode", await this.getCurrentGeofencingMode());
    }

    public async syncHomeInfo(): Promise<void> {
        const info = await this.api.getHome(this.id);

        await this.setCapabilityValue("tado_room_count", info.zonesCount);

        await this.configureAutoAssist(info.skills.includes("AUTO_ASSIST"));
    }

    /**
     * ------------------------------------------------------------------
     * Zone Management
     * ------------------------------------------------------------------
     */

    private async getActiveZoneIds(): Promise<number[]> {
        return this.api.getZones(this.id).then((zones) => zones.map((zone) => zone.id));
    }

    public async resumeSchedule(...zoneIds: number[]): Promise<void> {
        await this.api.clearZoneOverlays(this.id, zoneIds.length > 0 ? zoneIds : await this.getActiveZoneIds());
    }

    public async boostHeating({
        zoneIds,
        durationSeconds,
    }: {
        zoneIds?: number[];
        durationSeconds?: number;
    }): Promise<void> {
        await this.api.setBoostHeatingOverlay(
            this.id,
            zoneIds && zoneIds.length > 0 ? zoneIds : await this.getActiveZoneIds(),
            durationSeconds ?? 1800,
        );
    }

    /**
     * ------------------------------------------------------------------
     * Gas Meter
     * ------------------------------------------------------------------
     */

    public async syncGasMeterReading(): Promise<void> {
        if (!this.hasCapability("meter_gas")) return;

        try {
            const { readings } = await this.api.getEnergyIQMeterReadings(this.id);
            const reading = readings.length > 0 ? readings[0].reading : 0;
            await this.setCapabilityValue("meter_gas", reading);
        } catch (error) {
            this.log("Unable to retrieve meter readings", error);
            return;
        }
    }

    /**
     * ------------------------------------------------------------------
     * Energy Meters
     * ------------------------------------------------------------------
     */

    public async syncEnergyConsumption(): Promise<void> {
        const today = new Date();

        const consumptionDetails: EnergyIQConsumptionDetails = await this.api.getEnergyIQConsumptionDetails(
            this.id,
            today.getMonth() + 1,
            today.getFullYear(),
        );

        await this.setCapabilityValue(
            "meter_power.daily_consumption_average",
            consumptionDetails.summary.averageDailyConsumption,
        );
        await this.setCapabilityValue("meter_power.monthly_consumption", consumptionDetails.summary.consumption);

        const perDateConsumption =
            consumptionDetails.graphConsumption.monthlyAggregation.requestedMonth.consumptionPerDate;
        const dailyConsumption = perDateConsumption[perDateConsumption.length - 1]?.consumption ?? 0;
        await this.setCapabilityValue("meter_power.daily_consumption", dailyConsumption);
    }

    /**
     * ------------------------------------------------------------------
     * Air Comfort
     * ------------------------------------------------------------------
     */

    public async syncWeather(): Promise<void> {
        const weather = await this.api.getWeather(this.id);
        await this.setCapabilityValue("tado_weather_state", weather.weatherState.value);
        await this.setCapabilityValue("measure_temperature.outside", weather.outsideTemperature.celsius);
        await this.setCapabilityValue("tado_solar_intensity", weather.solarIntensity.percentage);
    }
};
