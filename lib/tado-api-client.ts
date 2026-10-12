import { StatePresence, Tado, TadoX, Termination, XRoom, XTermination, ZoneState } from "node-tado-client";

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

/**
 * Every room of a home comes back from a single request, but each room
 * device polls on its own timer. Holding the result for as long as the
 * caller can tolerate keeps a home to one request per polling interval
 * whatever the number of rooms, and readers that arrive together share
 * the request instead of stacking one each.
 */
class SharedRoomState<T> {
    private readonly snapshots = new Map<number, { fetchedAt: number; value: T }>();
    private readonly inFlight = new Map<number, Promise<T>>();

    public constructor(private readonly load: (home_id: number) => Promise<T>) {}

    public async get(home_id: number, maxAgeMs: number): Promise<T> {
        const snapshot = this.snapshots.get(home_id);
        if (snapshot !== undefined && Date.now() - snapshot.fetchedAt < maxAgeMs) {
            return snapshot.value;
        }

        let inFlight = this.inFlight.get(home_id);
        if (inFlight === undefined) {
            inFlight = this.load(home_id);
            this.inFlight.set(home_id, inFlight);
            inFlight
                .then((value) => {
                    this.snapshots.set(home_id, { fetchedAt: Date.now(), value });
                })
                .catch(() => undefined)
                .finally(() => {
                    this.inFlight.delete(home_id);
                });
        }

        return inFlight;
    }
}

export class TadoApiClient extends Tado {
    private readonly roomStateSnapshot = new SharedRoomState<Map<number, ZoneState>>(async (home_id) => {
        const { zoneStates } = await this.getZoneStates(home_id);
        return new Map(Object.entries(zoneStates).map(([zone_id, zone]) => [Number(zone_id), zone]));
    });

    /**
     * The states of every zone in a home, keyed by zone id.
     *
     * @param maxAgeMs How old a snapshot may be before the caller wants a
     *   newer one. Callers pass their own polling interval, so a home
     *   spends one request per interval however many rooms share it.
     */
    public async getRoomStates(home_id: number, maxAgeMs: number): Promise<Map<number, ZoneState>> {
        return this.roomStateSnapshot.get(home_id, maxAgeMs);
    }

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
    private readonly roomStateSnapshot = new SharedRoomState<{ rooms: Map<number, XRoom>; presence: StatePresence }>(
        async (home_id) => {
            const [rooms, home] = await Promise.all([this.getRooms(home_id), this.getState(home_id)]);
            return { rooms: new Map(rooms.map((room) => [room.id, room])), presence: home.presence };
        },
    );

    /**
     * The states of every room in a home, keyed by room id, along with
     * the presence the hops api only reports once per home.
     *
     * @param maxAgeMs How old a snapshot may be before the caller wants a
     *   newer one. Callers pass their own polling interval, so a home
     *   spends two requests per interval however many rooms share it.
     */
    public async getRoomStates(
        home_id: number,
        maxAgeMs: number,
    ): Promise<{ rooms: Map<number, XRoom>; presence: StatePresence }> {
        return this.roomStateSnapshot.get(home_id, maxAgeMs);
    }

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
