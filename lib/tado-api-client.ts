import { Tado, TadoX, Termination, XTermination } from "node-tado-client";

export class TadoApiClient extends Tado {
    public async boostHeating(home_id: number, room_ids: number[], durationSeconds: number = 1800): Promise<void> {
        await this.setZoneOverlays(
            home_id,
            room_ids.map((room_id) => {
                return {
                    isBoost: true,
                    power: "ON",
                    temperature: {
                        celsius: 25,
                        fahrenheit: 77,
                    },
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
        const isOff = value < 5.0;
        // the api only allows a supported range of 5–25°C
        const temperature = isOff ? null : { celsius: Math.max(Math.min(value, 25.0), 5.0) };

        this.setZoneOverlays(
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
        room_ids.map(async (room_id: number) => {
            await this.manualControl(home_id, room_id, "ON", durationSeconds, 25);
        });
    }

    public async setRoomTemperature(
        home_id: number,
        room_id: number,
        termination: XTermination | "AUTO" | number,
        value: number,
    ): Promise<void> {
        const isOff = value < 5.0;
        // the api only allows a supported range of 5–25°C
        const temperature = isOff ? undefined : Math.max(Math.min(value, 30.0), 5.0);

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
