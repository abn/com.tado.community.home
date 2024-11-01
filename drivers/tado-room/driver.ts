import { OAuth2Driver } from "homey-oauth2app";
import { TadoOAuth2Client } from "../../lib/tado-oauth2-client";

module.exports = class TadoRoomDriver extends OAuth2Driver<TadoOAuth2Client> {
    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    override async onPairListDevices({
        oAuth2Client,
    }: {
        oAuth2Client: TadoOAuth2Client;
    }): Promise<{ name: string; data: { id: number; homeId: number } }[]> {
        this.log("Listing room devices available to be added");
        const { homes } = await oAuth2Client.tado.getMe();
        const devices = [];

        for (const home of homes) {
            const zones = await oAuth2Client.tado.getZones(home.id);

            devices.push(
                ...zones.map((zone) => {
                    return {
                        name: `${home.name} / ${zone.name}`,
                        data: {
                            id: zone.id,
                            homeId: home.id,
                            type: zone.type,
                        },
                    };
                }),
            );
        }

        return devices;
    }
};
