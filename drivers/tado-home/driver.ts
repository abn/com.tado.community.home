import { TadoOAuth2Client } from "../../lib/tado-oauth2-client";
import { HomeGeneration } from "node-tado-client";
import { TadoOAuth2Driver } from "../../lib/tado-oauth2-driver";

module.exports = class TadoHomeDriver extends TadoOAuth2Driver {
    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    override async onPairListDevices({
        oAuth2Client,
    }: {
        oAuth2Client: TadoOAuth2Client;
    }): Promise<{ name: string; data: { id: number; generation: HomeGeneration }; capabilities: string[] }[]> {
        this.log("Listing devices available to be added");
        const { homes } = await oAuth2Client.tado.getMe();

        return Promise.all(
            homes.map(async (home) => {
                const home_info = await oAuth2Client.tado.getHome(home.id);

                return {
                    name: home.name,
                    data: {
                        id: home.id,
                        generation: home_info.generation,
                    },
                    // we do this here to avoid creating EIQ insights metric for non-auto-assist users
                    capabilities: [
                        "tado_presence_mode",
                        "tado_weather_state",
                        "measure_temperature.outside",
                        "tado_solar_intensity",
                        "tado_room_count",
                        "tado_resume_schedule",
                        "tado_boost_heating",
                        "tado_geofencing_mode",
                        "tado_is_anyone_home",
                        "button.restart_polling",
                    ],
                };
            }),
        );
    }
};
