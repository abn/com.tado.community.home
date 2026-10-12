import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { Termination, XRoom, ZoneState } from "node-tado-client";

export class TadoRoomDevice extends TadoApiDevice {
    private static readonly ROOM_STATE_SETTING = "room_state_polling_interval";
    /**
     * The room state interval the app ships in its settings, used when a
     * device has none stored. Erring low costs a request, never stale data.
     */
    private static readonly ROOM_STATE_INTERVAL_SECONDS = 60;

    private get home_id(): number {
        return this.getData().homeId;
    }

    private get id(): number {
        return this.getData().id;
    }

    /**
     * How old a shared room state snapshot may be before this device
     * would rather ask for a newer one. Reading this device's own
     * interval keeps every room of a home sharing the same request,
     * while a room polling more often than the rest stays honest.
     */
    private get roomStateMaxAgeMs(): number {
        const interval = this.getSetting(TadoRoomDevice.ROOM_STATE_SETTING);
        return (typeof interval === "number" ? interval : TadoRoomDevice.ROOM_STATE_INTERVAL_SECONDS) * 1000;
    }

    protected override get intervalConfigs(): IntervalConfigurationCollection<TadoRoomDevice> {
        return {
            ROOM_STATE: {
                functionName: "syncRoomState",
                settingName: TadoRoomDevice.ROOM_STATE_SETTING,
            },
            EARLY_START: {
                functionName: "syncEarlyStart",
                settingName: "early_start_polling_interval",
                disableAutoStart: true,
            },
        };
    }

    public async boostHeating(duration: number): Promise<void> {
        await this.api.boostHeating(this.home_id, [this.id], duration);
    }

    public async actionSetEarlyStart(enabled: boolean): Promise<void> {
        if (this.isGenerationX) throw new Error("Tado X does not support early start");
        await this.setEarlyStart(enabled);
    }

    protected override async start(): Promise<void> {
        this.registerCapabilityListener("button.restart_polling", async () => {
            await this.intervalManager.restart();
        });

        this.registerCapabilityListener("onoff", this.setOnOff.bind(this));

        if (this.hasCapability("onoff.early_start")) {
            this.registerCapabilityListener("onoff.early_start", this.setEarlyStart.bind(this));
            await this.intervalManager.start("EARLY_START");
        }

        this.registerCapabilityListener("tado_boost_heating", async (value) => {
            if (value) await this.api.boostHeating(this.home_id, [this.id], 1800);
        });

        this.registerCapabilityListener("tado_resume_schedule", this.resumeSchedule.bind(this));

        this.registerCapabilityListener("target_temperature", async (value) => {
            await this.setRoomTargetTemperature(value, "AUTO");
        });
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {
        if (this.getClass() !== "thermostat") {
            // this was changed in v2.3.0
            await this.setClass("thermostat").catch(this.error);
        }

        await this.migrateAddCapabilities(
            // Available from v1.0.4
            "tado_boost_heating",
            "tado_heating_power",
            // Available from v1.1.3
            "onoff.smart_schedule",
            // Available from v1.1.4
            "alarm_open_window_detected",
            // Available from v3.1.0
            "alarm_room_connectivity",
        );

        // Configured since v1.2.4
        await this.migrateGeneration(this.home_id);

        if (this.isGenerationX && this.hasCapability("onoff.early_start")) {
            // Generation X does not support early start yet
            await this.intervalManager.stop("EARLY_START").catch(this.error);
            await this.migrateRemoveCapabilities("onoff.early_start");
        } else {
            // Available from v1.1.4
            await this.migrateAddCapabilities("onoff.early_start");
        }

        // this should always happen at the end to avoid any munging and ensure generation is set
        if (this.isGenerationX) {
            const target_temperature_options = this.getCapabilityOptions("target_temperature");

            if (target_temperature_options.max !== 30) {
                // generation x rooms now allow you to set temperatures to 30
                target_temperature_options.max = 30;
                await this.setCapabilityOptions("target_temperature", target_temperature_options);
            }
        }
    }

    /**
     * ------------------------------------------------------------------
     * Helper Functions
     * ------------------------------------------------------------------
     */
    public async resumeSchedule(): Promise<void> {
        await this.api.resumeScheduleHomey(this.home_id, this.id);
        await this.setCapabilityValue("onoff.smart_schedule", true);
    }

    protected async setOnOff(value: boolean): Promise<void> {
        if (value) {
            await this.resumeSchedule();
        } else {
            await this.setRoomTargetTemperature(0.0, "MANUAL");
        }
    }

    protected async setEarlyStart(value: boolean): Promise<void> {
        if (!this.isGenerationX) {
            await this.api_v2.setZoneEarlyStart(this.home_id, this.id, value).catch(this.error);
        }
    }

    protected async setRoomTargetTemperature(
        value: number,
        termination: Termination | number = "NEXT_TIME_BLOCK",
    ): Promise<void> {
        const isOff = value < 5.0;
        const previousValue = this.getCapabilityValue("target_temperature");
        await this.api
            .setRoomTemperature(this.home_id, this.id, termination, value)
            .then(async () => {
                // we reset value to ensure turning off does not change the value
                await this.setCapabilityValue("target_temperature", isOff ? previousValue : Math.max(0.0, value));
                await this.setCapabilityValue("onoff", !isOff);
            })
            .catch(async (...args) => {
                await this.setCapabilityValue("target_temperature", previousValue);
                this.error(...args);
            });
    }

    /**
     * ------------------------------------------------------------------
     * Room Info Management
     * ------------------------------------------------------------------
     */
    public async syncRoomState(): Promise<void> {
        let state: XRoom | ZoneState;
        let tado_heating_power: number | undefined = undefined;
        let measure_temperature: number;
        let target_temperature: number | undefined;
        let tado_presence_mode;
        let isSmartScheduleOn;
        let isBoosting: boolean;
        let isConnected: boolean;

        try {
            if (this.isGenerationX) {
                const { rooms, presence } = await this.api_x.getRoomStates(this.home_id, this.roomStateMaxAgeMs);
                const room = rooms.get(this.id);
                if (room === undefined) {
                    this.log("Room is missing from the home response, skipping state sync");
                    return;
                }

                state = room;
                measure_temperature = state.sensorDataPoints.insideTemperature.value;
                // tado_presence_mode = state;
                isSmartScheduleOn = state.manualControlTermination === null;
                target_temperature = state.setting.temperature?.value;
                tado_heating_power = state.heatingPower?.percentage;
                // boost is reported as a mode of its own and leaves the
                // setting temperature empty
                isBoosting = state.boostMode != null;
                // node-tado-client types the field as `string`, but the hops
                // api returns the connection state as `state`
                isConnected = (state.connection as { state?: string })?.state === "CONNECTED";

                // the hops api does not provide geo location data in initial response
                tado_presence_mode = presence.toLowerCase();
            } else {
                const rooms = await this.api_v2.getRoomStates(this.home_id, this.roomStateMaxAgeMs);
                const zone = rooms.get(this.id);
                if (zone === undefined) {
                    this.log("Room is missing from the home response, skipping state sync");
                    return;
                }

                state = zone;
                measure_temperature = state.sensorDataPoints.insideTemperature.celsius;
                tado_presence_mode = state.tadoMode.toLowerCase();
                isSmartScheduleOn = state.overlayType === null;
                target_temperature = state.setting.temperature?.celsius;
                isBoosting = state.setting.isBoost === true;
                isConnected = state.link?.state == "ONLINE";

                if ("heatingPower" in state.activityDataPoints) {
                    tado_heating_power =
                        state.activityDataPoints.heatingPower?.type == "PERCENTAGE"
                            ? state.activityDataPoints.heatingPower.percentage
                            : 0.0;
                }
            }

            await this.setCapabilityValue("measure_humidity", state.sensorDataPoints.humidity.percentage);
            await this.setCapabilityValue("measure_temperature", measure_temperature);
            await this.setCapabilityValue("tado_presence_mode", tado_presence_mode);
            await this.setCapabilityValue("onoff.smart_schedule", isSmartScheduleOn);
            await this.setCapabilityValue("alarm_room_connectivity", isConnected);

            const isWindowOpen = state.openWindow !== null;
            await this.setCapabilityValue("alarm_open_window_detected", isWindowOpen);

            const isTurnedOn = state.setting.power == "ON";
            await this.setCapabilityValue("onoff", isTurnedOn);

            if (isBoosting) {
                await this.setCapabilityValue("target_temperature", this.boostTemperature);
            } else if (target_temperature || isTurnedOn) {
                await this.setCapabilityValue("target_temperature", target_temperature ?? 5.0);
            }

            if (tado_heating_power !== undefined) {
                await this.setCapabilityValue("tado_heating_power", tado_heating_power);
            }
        } catch (error) {
            this.log("Failed to sync room state");
            this.error(error);
        }
    }

    public async syncEarlyStart(): Promise<void> {
        if (this.isGenerationX) return;

        await this.api_v2
            .isZoneEarlyStartEnabled(this.home_id, this.id)
            .then(async (enabled) => {
                await this.setCapabilityValue("onoff.early_start", enabled).catch(this.error);
            })
            .catch(this.error);
    }

    /**
     * ------------------------------------------------------------------
     * Device Event Management
     * ------------------------------------------------------------------
     */
}

module.exports = TadoRoomDevice;
