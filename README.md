# MOVA Vacuum for Homey

Homey Apps SDK v3 app that connects a **MOVA V70** (any `mova.vacuum.*` on MOVAhome) by logging in with MOVAhome credentials.

## Pairing

Homey logs in with **email and password only**. A website login code from mova.tech will not work.

1. In the official **MOVAhome** app, set a password for your account (Forgot password / Set password). Do this even if you originally signed up with Apple ID.
2. In Homey, add a device → **MOVA Vacuum**
3. Choose your MOVAhome cloud region
4. Enter that email and password
5. Select the vacuum from the account’s device list

## Controls

| Homey | MOVAhome / MIOT |
| --- | --- |
| Start vacuuming | `set_properties` cleaning mode then `action` start (`siid=2, aiid=1`) |
| Start mopping | mop-only or vacuum-and-mop cleaning mode, then start |
| Pause | `siid=2, aiid=2` |
| Stop | `siid=4, aiid=2` |
| Return to dock | `siid=3, aiid=1` |
| Locate | `siid=7, aiid=1` |
| Suction | Quiet / Standard / Strong / Turbo (`siid=4, piid=4`) |
| Water level | Low / Medium / High (`siid=4, piid=5`) |
| CleanGenius | Off / Routine / Deep (`siid=4, piid=50` SmartHost) |
| Empty dustbin | `siid=15, aiid=1` |
| Wash mop | `siid=4, aiid=4` |
| Battery | `siid=3, piid=1` |
| Cleaning time / area | current job minutes and m² (`siid=4, piid=2/3`) |
| Status | vacuuming, mopping, vacuum & mop, returning, docked, charging |
| Problem alarm | device fault (`siid=2, piid=2`) |
| Consumables | remaining life % for main brush, side brush, filter, mop pad, sensors |
| Dashboard widget | Live floor map and robot position (Homey Pro 12.3+) |

## Map widget

MOVAhome exposes the same Dreame floor map as the official app (MIOT map service `siid=6`: live I/P-frames, OSS map file, robot pose). Add the **Robot map** widget to a Homey dashboard and pick your vacuum. While the robot is cleaning the widget refreshes every few seconds.

Protocol is the reverse-engineered MOVAhome cloud API used by [matterbridge-mova](https://github.com/diveflo/matterbridge-mova) (OAuth password grant to `*.iot.mova-tech.com:13267`, MD5 password + salt, `Dreame-Auth`, `device/listV2`, `sendCommand`).
