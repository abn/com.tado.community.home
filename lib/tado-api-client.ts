import { Tado } from "node-tado-client";

export class TadoApiClient extends Tado {
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

    public async setBoostHeatingOverlay(homeId: number, zoneIds: number[]): Promise<void> {
        await this.setZoneOverlays(
            homeId,
            zoneIds.map((zoneId) => {
                return {
                    isBoost: true,
                    power: "ON",
                    temperature: {
                        celsius: 25,
                        fahrenheit: 77,
                    },
                    zone_id: zoneId,
                };
            }),
            1800,
        );
    }
}
