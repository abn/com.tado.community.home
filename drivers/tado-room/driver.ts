import { TadoOAuth2Client } from "../../lib/tado-oauth2-client";
import { HomeGeneration } from "node-tado-client";
import { TadoOAuth2Driver } from "../../lib/tado-oauth2-driver";

module.exports = class TadoRoomDriver extends TadoOAuth2Driver {
    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    override async onPairListDevices({
        oAuth2Client,
    }: {
        oAuth2Client: TadoOAuth2Client;
    }): Promise<{ name: string; data: { id: number; homeId: number; generation: HomeGeneration } }[]> {
        this.log("Listing room devices available to be added");
        const { homes } = await oAuth2Client.tado.getMe();
        const devices = [];

        for (const home of homes) {
            const home_info = await oAuth2Client.tado.getHome(home.id);

            const rooms =
                home_info.generation === "PRE_LINE_X"
                    ? await oAuth2Client.tado.getZones(home.id)
                    : await oAuth2Client.tadox.getRooms(home.id);

            devices.push(
                ...rooms.map((room) => {
                    return {
                        name: `${home.name} / ${room.name}`,
                        data: {
                            id: room.id,
                            homeId: home.id,
                            generation: home_info.generation,
                        },
                    };
                }),
            );
        }

        return devices;
    }
};
