# Homey App: tado° Home Manager

The tado° Home Manager app enhances your smart home experience by integrating advanced capabilities for your tado°
Homes and Rooms, going beyond the features offered in the official Athom app. It provides seamless control over your
home's climate, optimizing daily routines and ensuring a comfortable living environment. Including the ability to
trigger flows based on home presence modes.

Standout features include: Home/Away mode triggers and action support, Resume schedule & Boost button support,
EnergyIQ capability, Weather & AirComfort features etc.

## Important Authentication Update

Starting from the latest version, this app has updated its authentication method to use tado°'s new device code flow.
This change was required due to tado° deprecating the previous password authentication method.

### What this means for you:

1. **New Authentication Process**: When adding a new device or if your existing device needs to re-authenticate, you'll see a new login screen with a verification code.

2. **How to Authenticate**:

    - You'll be shown a verification code and a link to tado°'s website
    - Visit the link on any device (phone, tablet, computer)
    - Enter the verification code (or it may be pre-filled)
    - Login with your tado° account credentials
    - Approve the connection

3. **Existing Connections**: Your existing connections will continue to work until the tokens expire. When they do, you'll need to re-authenticate using the new method.

This change improves security while maintaining all existing functionality of the app.

## Request limits

tado° limits how often the app may call its cloud. The allowance is 100 requests a day without a subscription and
20,000 a day with Auto Assist or AI Assist, see
[tado°'s own explanation](https://help.tado.com/en/articles/12165739-limitation-for-rest-api-usage).

The app reads the allowance from every response it gets and stops asking once the day is used up, then picks up again
when the allowance resets. A room keeps showing its last known state in the meantime rather than reporting an error.

All rooms of a home share the same set of requests per polling interval, so adding rooms does not cost extra requests.
To spend less of the allowance, raise the polling intervals in a device's settings.
