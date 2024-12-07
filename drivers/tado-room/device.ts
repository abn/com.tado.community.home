import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { Termination, XRoom, ZoneState } from "node-tado-client";

module.exports = class TadoRoomDevice extends TadoApiDevice {
    private get home_id(): number {
        return this.getData().homeId;
    }

    private get id(): number {
        return this.getData().id;
    }

    protected override get intervalConfigs(): IntervalConfigurationCollection<TadoRoomDevice> {
        return {
            ROOM_STATE: {
                functionName: "syncRoomState",
                settingName: "room_state_polling_interval",
            },
            EARLY_START: {
                functionName: "syncEarlyStart",
                settingName: "early_start_polling_interval",
                disableAutoStart: true,
            },
        };
    }

    async registerActionFlows(): Promise<void> {
        const resumeScheduleAction = this.homey.flow.getActionCard("tado_room_resume_schedule");
        resumeScheduleAction.registerRunListener(async () => {
            await this.resumeSchedule();
        });

        const boostHeatingAction = this.homey.flow.getActionCard("tado_room_boost_heating");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        boostHeatingAction.registerRunListener(async (args: { duration?: number }, state: unknown) => {
            await this.api.boostHeating(this.home_id, [this.id], args.duration ? args.duration / 1000 : 1800);
        });

        const earlyStartSetAction = this.homey.flow.getActionCard("tado_room_early_start_set");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        earlyStartSetAction.registerRunListener(async (args: { enabled: boolean }, state: unknown) => {
            if (this.isGenerationX) throw new Error("Tado X does not support early start");
            await this.setEarlyStart(args.enabled);
        });
    }

    async registerConditionFlows(): Promise<void> {
        const smartScheduledStatusCondition = this.homey.flow.getConditionCard("tado_room_smart_schedule_status");
        smartScheduledStatusCondition.registerRunListener(async () => {
            return this.getCapabilityValue("onoff.smart_schedule");
        });

        const openWindowDetectedCondition = this.homey.flow.getConditionCard("tado_room_open_window_detected");
        openWindowDetectedCondition.registerRunListener(async () => {
            return this.getCapabilityValue("alarm_open_window_detected");
        });

        const earlyStartStatusCondition = this.homey.flow.getConditionCard("tado_room_early_start_status");
        earlyStartStatusCondition.registerRunListener(async () => {
            if (this.isGenerationX) return false;
            return this.getCapabilityValue("onoff.early_start");
        });
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

        await this.registerActionFlows();
        await this.registerConditionFlows();
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {
        await this.migrateAddCapabilities(
            // Available from v1.0.4
            "tado_boost_heating",
            "tado_heating_power",
            // Available from v1.1.3
            "onoff.smart_schedule",
            // Available from v1.1.4
            "alarm_open_window_detected",
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
    protected async resumeSchedule(): Promise<void> {
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

        if (this.isGenerationX) {
            state = await this.api_x.getRoomState(this.home_id, this.id);
            measure_temperature = state.sensorDataPoints.insideTemperature.value;
            // tado_presence_mode = state;
            isSmartScheduleOn = state.manualControlTermination === null;
            target_temperature = state.setting.temperature?.value;
            tado_heating_power = state.heatingPower?.percentage;

            // the hops api does not provide geo location data in initial response
            const home_state = await this.api_x.getState(this.home_id);
            tado_presence_mode = home_state.presence.toLowerCase();
        } else {
            state = await this.api_v2.getZoneState(this.home_id, this.id);
            measure_temperature = state.sensorDataPoints.insideTemperature.celsius;
            tado_presence_mode = state.tadoMode.toLowerCase();
            isSmartScheduleOn = state.overlayType === null;
            target_temperature = state.setting.temperature?.celsius;

            if ("heatingPower" in state.activityDataPoints) {
                tado_heating_power =
                    state.activityDataPoints.heatingPower?.type == "PERCENTAGE"
                        ? state.activityDataPoints.heatingPower.percentage
                        : 0.0;
            }
        }

        // await this.setCapabilityValue("alarm_connectivity", state.link.state == "ONLINE");
        await this.setCapabilityValue("measure_humidity", state.sensorDataPoints.humidity.percentage);
        await this.setCapabilityValue("measure_temperature", measure_temperature);
        await this.setCapabilityValue("tado_presence_mode", tado_presence_mode);
        await this.setCapabilityValue("onoff.smart_schedule", isSmartScheduleOn);

        const isWindowOpen = state.openWindow !== null;
        await this.setCapabilityValue("alarm_open_window_detected", isWindowOpen);

        const isTurnedOn = state.setting.power == "ON";
        await this.setCapabilityValue("onoff", isTurnedOn);

        if (target_temperature || isTurnedOn)
            await this.setCapabilityValue("target_temperature", target_temperature ?? 5.0);

        if (tado_heating_power !== undefined) {
            await this.setCapabilityValue("tado_heating_power", tado_heating_power);
        }
    }

    public async syncEarlyStart(): Promise<void> {
        if (this.isGenerationX) return;

        await this.setCapabilityValue(
            "onoff.early_start",
            await this.api_v2.isZoneEarlyStartEnabled(this.home_id, this.id),
        );
    }

    /**
     * ------------------------------------------------------------------
     * Device Event Management
     * ------------------------------------------------------------------
     */
};
