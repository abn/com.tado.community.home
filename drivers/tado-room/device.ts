import { TadoApiDevice } from "../../lib/tado-api-device";

import type { IntervalConfigurationCollection } from "homey-interval-manager";
import type { Termination, ZoneType } from "node-tado-client";

module.exports = class TadoRoomDevice extends TadoApiDevice {
    private get home_id(): number {
        return this.getData().homeId;
    }

    private get id(): number {
        return this.getData().id;
    }

    private get type(): ZoneType {
        return this.getData().type;
    }

    protected override get intervalConfigs(): IntervalConfigurationCollection<TadoRoomDevice> {
        return {
            ROOM_STATE: {
                functionName: "syncRoomState",
                settingName: "room_state_polling_interval",
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
            await this.api.setBoostHeatingOverlay(this.home_id, [this.id], args.duration ? args.duration / 1000 : 1800);
        });
    }

    protected override async start(): Promise<void> {
        this.registerCapabilityListener("button.restart_polling", async () => {
            await this.intervalManager.restart();
        });

        this.registerCapabilityListener("onoff", this.setOnOff.bind(this));

        this.registerCapabilityListener("tado_boost_heating", async (value) => {
            if (value) await this.api.setBoostHeatingOverlay(this.home_id, [this.id], 1800);
        });

        this.registerCapabilityListener("tado_resume_schedule", this.resumeSchedule.bind(this));

        this.registerCapabilityListener("target_temperature", async (value) => {
            await this.setRoomTargetTemperature(value, "AUTO");
        });

        await this.registerActionFlows();
    }

    protected override async stop(): Promise<void> {
        await super.stop();
    }

    protected override async migrate(): Promise<void> {
        await this.migrateAddCapabilities(
            // Available from v1.0.4
            "tado_boost_heating",
            "tado_heating_power",
        );
    }

    /**
     * ------------------------------------------------------------------
     * Helper Functions
     * ------------------------------------------------------------------
     */
    protected async resumeSchedule(): Promise<void> {
        await this.api.clearZoneOverlays(this.home_id, [this.id]);
    }

    protected async setOnOff(value: boolean): Promise<void> {
        if (value) {
            await this.resumeSchedule();
        } else {
            await this.setRoomTargetTemperature(0.0, "MANUAL");
        }
    }

    protected async setRoomTargetTemperature(
        value: number,
        termination: Termination | number = "NEXT_TIME_BLOCK",
    ): Promise<void> {
        const isOff = value < 5.0;
        const previousValue = this.getCapabilityValue("target_temperature");

        await this.api
            .setZoneOverlays(
                this.home_id,
                [
                    {
                        zone_id: this.id,
                        power: isOff ? "OFF" : "ON",
                        temperature: isOff
                            ? null
                            : {
                                  // the api only allows a supported range of 5–25°C
                                  celsius: Math.max(Math.min(value, 25.0), 5.0),
                              },
                    },
                ],
                termination,
            )
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
        const state = await this.api.getZoneState(this.home_id, this.id);
        // await this.setCapabilityValue("alarm_connectivity", state.link.state == "ONLINE");
        await this.setCapabilityValue("measure_humidity", state.sensorDataPoints.humidity.percentage);
        await this.setCapabilityValue("measure_temperature", state.sensorDataPoints.insideTemperature.celsius);
        await this.setCapabilityValue("tado_presence_mode", state.tadoMode.toLowerCase());

        const isTurnedOn = state.setting.power == "ON";
        await this.setCapabilityValue("onoff", isTurnedOn);

        if (state.setting.temperature?.celsius || isTurnedOn)
            await this.setCapabilityValue("target_temperature", state.setting.temperature?.celsius ?? 5.0);

        await this.setCapabilityValue(
            "tado_heating_power",
            state.activityDataPoints.heatingPower?.type == "PERCENTAGE"
                ? state.activityDataPoints.heatingPower.percentage
                : 0.0,
        );
    }

    /**
     * ------------------------------------------------------------------
     * Device Event Management
     * ------------------------------------------------------------------
     */
};
