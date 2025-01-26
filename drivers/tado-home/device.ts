import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { State, StatePresence, TadoMode } from "node-tado-client";

export class TadoHomeDevice extends TadoApiDevice {
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

    public async reportMeterReading(reading: number, date?: string): Promise<void> {
        await this.api.addEnergyIQMeterReading(this.id, this.formatFlowArgDate(date), reading);
    }

    public async actionSetGeofencingMode(mode: string, duration?: number): Promise<void> {
        const previousGeofencingMode = await this.getCapabilityValue("tado_geofencing_mode");
        await this.setGeofencingMode(mode.toUpperCase() as StatePresence);

        if (duration != null) {
            await this.homey.setTimeout(async () => {
                try {
                    const currentGeofencingMode = await this.getCurrentGeofencingMode();

                    if (currentGeofencingMode === mode) {
                        this.log(
                            `[Action:set_geofencing_mode] Duration set has elapsed, resetting geofencing mode to ${previousGeofencingMode}`,
                        );
                        await this.setGeofencingMode(previousGeofencingMode.toUpperCase() as StatePresence).catch(
                            this.error,
                        );
                    } else {
                        this.log(
                            "[Action:set_geofencing_mode] Duration set has elapsed but mode has changed elsewhere, skipping reset",
                        );
                    }
                } catch (error) {
                    this.log("[Action:set_geofencing_mode] Failed to reset geofencing mode", error);
                }
            }, duration);
        }
    }

    protected override async start(): Promise<void> {
        if (this.initialised) return;

        this.registerCapabilityListener("tado_geofencing_mode", async (value: StatePresence) => {
            await this.setGeofencingMode(value);
        });

        this.registerCapabilityListener("tado_boost_heating", async (value) => {
            if (value) await this.boostHeating({ duration_seconds: 1800 });
        });

        this.registerCapabilityListener("tado_resume_schedule", async (value) => {
            if (value) await this.resumeSchedule();
        });

        this.registerCapabilityListener("button.restart_polling", async () => {
            await this.intervalManager.restart();
        });
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {
        await this.migrateAddCapabilities(
            // Available from v1.0.4
            "tado_boost_heating",
        );

        // Configured since v1.2.4
        await this.migrateGeneration(this.id);
    }

    /**
     * Formats a string date in DD-MM-YYYY format to a standardized date string usable by tado
     * in the format YYYY-MM-DD. This is useful for handling Homey's #Date tag input.
     *
     * @param date - The date string in DD-MM-YYYY format, defaults to today.
     * @return The formatted date string.
     */
    private formatFlowArgDate(date?: string | undefined): string {
        if (!date) return this.dateString();

        const datePattern = /^\d{2}-\d{2}-\d{4}$/;
        if (!datePattern.test(date.trim())) {
            throw new Error("Invalid date format. Please use DD-MM-YYYY.");
        }

        const [day, month, year] = date.trim().split("-").map(Number);

        return this.dateString(new Date(year, month - 1, day));
    }

    private async setTadoPresenceMode(value: TadoMode): Promise<void> {
        await this.setCapabilityValue("tado_presence_mode", value.toLowerCase()).catch(this.error);
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

    private async getCurrentGeofencingMode(): Promise<"auto" | "home" | "away"> {
        const state = await this.getCurrentHomeState();
        const isAutoAssistEnabled = this.isAutoAssistEnabled();

        const statePresence = state.presence.toLowerCase() as "auto" | "home" | "away";

        // this allows for non auto assist enabled users to rely on mobile device locations
        await this.setCapabilityValue(
            "tado_is_anyone_home",
            isAutoAssistEnabled ? statePresence == "home" : await this.api.isAnyoneAtHome(this.id),
        );

        return state.presenceLocked || !isAutoAssistEnabled ? statePresence : "auto";
    }

    public async syncGeofencingMode(): Promise<void> {
        await this.getCurrentGeofencingMode()
            .then(async (mode) => {
                await this.setCapabilityValue("tado_geofencing_mode", mode).catch(this.error);
            })
            .catch(this.error);
    }

    private async setGeofencingMode(value: StatePresence): Promise<void> {
        const state = value.toUpperCase() as StatePresence;

        if (state === "AUTO") {
            if (!this.isAutoAssistEnabled()) {
                this.log("Auto Assist is not enabled, cannot set geofencing mode to auto");
                throw new Error("Auto Assist is not enabled");
            }

            const devices = await this.api.getMobileDevices(this.id);
            const geo_tracking_available = devices.some((device) => device.settings.geoTrackingEnabled);

            if (!geo_tracking_available) {
                this.log("No mobile devices with geo tracking enabled, cannot set geofencing mode to auto");
                throw new Error("No mobile devices with geo tracking enabled");
            }
        }

        await this.api.setPresence(this.id, state);

        // Update geofencing mode after a short delay
        this.homey.setTimeout(async () => {
            await this.syncGeofencingMode().catch(this.error);
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

    private isEnergyIQEnabled(): boolean {
        return this.getSetting("energy_iq_enabled") == "Yes";
    }

    private async configureEnergyIQCapabilities(isEnabled: boolean): Promise<void> {
        await this.setSettings({
            energy_iq_enabled: isEnabled ? "Yes" : "No",
        });

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
        await this.setCapabilityValue("tado_geofencing_mode", await this.getCurrentGeofencingMode());
    }

    public async syncHomeInfo(): Promise<void> {
        try {
            const info = await this.api.getHome(this.id);
            const auto_assist_enabled = info.skills.includes("AUTO_ASSIST");
            const eqi_enabled = auto_assist_enabled && (info.isEnergyIqEligible ?? false);

            await Promise.all([
                this.setCapabilityValue("tado_room_count", info.zonesCount),
                this.configureAutoAssist(auto_assist_enabled),
                this.configureEnergyIQCapabilities(eqi_enabled),
            ]).catch(this.error);
        } catch (error) {
            this.log("Failed to sync home info", error);
        }
    }

    /**
     * ------------------------------------------------------------------
     * Zone Management
     * ------------------------------------------------------------------
     */

    public async resumeSchedule(): Promise<void> {
        await this.api.resumeScheduleHomey(this.id);
    }

    public async boostHeating({
        room_ids,
        duration_seconds,
    }: {
        room_ids?: number[];
        duration_seconds?: number;
    }): Promise<void> {
        await this.api.boostHeating(
            this.id,
            room_ids && room_ids.length > 0 ? room_ids : await this.api.getActiveRoomIds(this.id),
            duration_seconds ?? 1800,
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
            await this.setCapabilityValue("meter_gas", reading).catch(this.error);
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
        if (!this.isEnergyIQEnabled()) return;

        try {
            const today = new Date();

            const consumptionDetails = await this.api.getEnergyIQConsumptionDetails(
                this.id,
                today.getMonth() + 1,
                today.getFullYear(),
            );
            const perDateConsumption =
                consumptionDetails.graphConsumption.monthlyAggregation.requestedMonth.consumptionPerDate;
            const dailyConsumption = perDateConsumption[perDateConsumption.length - 1]?.consumption ?? 0;

            await Promise.all([
                this.setCapabilityValue(
                    "meter_power.daily_consumption_average",
                    consumptionDetails.summary.averageDailyConsumption,
                ),
                this.setCapabilityValue("meter_power.monthly_consumption", consumptionDetails.summary.consumption),
                this.setCapabilityValue("meter_power.daily_consumption", dailyConsumption),
            ]).catch(this.error);
        } catch (error) {
            this.log("Failed to sync energy consumption", error);
        }
    }

    /**
     * ------------------------------------------------------------------
     * Air Comfort
     * ------------------------------------------------------------------
     */

    public async syncWeather(): Promise<void> {
        try {
            const weather = await this.api.getWeather(this.id);
            await Promise.all([
                this.setCapabilityValue("tado_weather_state", weather.weatherState.value),
                this.setCapabilityValue("measure_temperature.outside", weather.outsideTemperature.celsius),
                this.setCapabilityValue("tado_solar_intensity", weather.solarIntensity.percentage),
            ]).catch(this.error);
        } catch (error) {
            this.log("Failed to sync weather", error);
        }
    }
}

module.exports = TadoHomeDevice;
