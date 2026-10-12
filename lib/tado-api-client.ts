import { Tado, TadoX, Termination, XTermination } from "node-tado-client";

/**
 * Boost heating drives a room to the top of the range its generation
 * supports: 5-25 °C for pre-line-X zones and 5-30 °C for line-X rooms.
 */
export const BOOST_TEMPERATURE_CELSIUS = {
    PRE_LINE_X: 25,
    LINE_X: 30,
} as const;

/** Both generations floor the range at the same temperature. */
const MINIMUM_TEMPERATURE_CELSIUS = 5.0;

function clampToSupportedRange(value: number, maximum: number): number {
    return Math.max(Math.min(value, maximum), MINIMUM_TEMPERATURE_CELSIUS);
}

export class TadoApiClient extends Tado {
    public async boostHeating(home_id: number, room_ids: number[], durationSeconds: number = 1800): Promise<void> {
        await this.setZoneOverlays(
            home_id,
            room_ids.map((room_id) => {
                return {
                    isBoost: true,
                    power: "ON",
                    temperature: { celsius: BOOST_TEMPERATURE_CELSIUS.PRE_LINE_X },
                    zone_id: room_id,
                };
            }),
            durationSeconds,
        );
    }

    public async setRoomTemperature(
        home_id: number,
        room_id: number,
        termination: Termination | number,
        value: number,
    ): Promise<void> {
        const isOff = value < MINIMUM_TEMPERATURE_CELSIUS;
        // the api only allows the range the generation supports
        const temperature = isOff
            ? null
            : { celsius: clampToSupportedRange(value, BOOST_TEMPERATURE_CELSIUS.PRE_LINE_X) };

        await this.setZoneOverlays(
            home_id,
            [
                {
                    zone_id: room_id,
                    power: isOff ? "OFF" : "ON",
                    temperature: temperature,
                },
            ],
            termination,
        );
    }

    public async getActiveRoomIds(home_id: number): Promise<number[]> {
        return this.getZones(home_id).then((zones) => zones.map((zone) => zone.id));
    }

    public async resumeScheduleHomey(home_id: number, room_id?: number): Promise<void> {
        return this.clearZoneOverlays(home_id, room_id ? [room_id] : await this.getActiveRoomIds(home_id));
    }
}

export class TadoXApiClient extends TadoX {
    public async boostHeating(home_id: number, room_ids: number[], durationSeconds: number = 1800): Promise<void> {
        await Promise.all(
            room_ids.map((room_id: number) => {
                return this.manualControl(home_id, room_id, "ON", durationSeconds, BOOST_TEMPERATURE_CELSIUS.LINE_X);
            }),
        );
    }

    public async setRoomTemperature(
        home_id: number,
        room_id: number,
        termination: XTermination | "AUTO" | number,
        value: number,
    ): Promise<void> {
        const isOff = value < MINIMUM_TEMPERATURE_CELSIUS;
        // the api only allows the range the generation supports
        const temperature = isOff ? undefined : clampToSupportedRange(value, BOOST_TEMPERATURE_CELSIUS.LINE_X);

        await this.manualControl(
            home_id,
            room_id,
            isOff ? "OFF" : "ON",
            termination === "AUTO" ? "NEXT_TIME_BLOCK" : termination,
            temperature,
        );
    }

    public async getActiveRoomIds(home_id: number): Promise<number[]> {
        return this.getRooms(home_id).then((rooms) => rooms.map((room) => room.id));
    }

    public async resumeScheduleHomey(home_id: number, room_id?: number): Promise<void> {
        if (room_id) {
            await this.resumeSchedule(home_id, room_id);
        } else {
            await this.performQuickAction(home_id, "resumeSchedule");
        }
    }
}
