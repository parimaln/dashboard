# Turning the display on and off

The project does not depend on any particular home-automation setup. What it
defines is a **two-command contract** that anything can call:

```bash
systemctl --user start dashboard-kiosk.service    # show the dashboard
systemctl --user stop  dashboard-kiosk.service    # exit the kiosk browser
```

Everything below is one worked example of wiring that up. Yours will differ, and
only these two commands need to stay the same.

## The kiosk service

Install `docs/kiosk/dashboard-kiosk.service` on the machine attached to the
television:

```bash
mkdir -p ~/.config/systemd/user
cp docs/kiosk/dashboard-kiosk.service ~/.config/systemd/user/
# edit the URL inside it, then:
systemctl --user daemon-reload
systemctl --user enable --now dashboard-kiosk.service

# So the service runs without anyone logging in first:
sudo loginctl enable-linger "$USER"
```

The machine now boots straight into the dashboard. That is deliberate: nothing has
to remote-control a browser, which removes most of the moving parts that make this
kind of setup fragile.

## Example: Google Home → Home Assistant → a Samsung TV

This is one specific chain. Substitute freely.

### "Show me my dashboard"

A Google Home routine calls a Home Assistant script (via the Google Assistant
integration or Nabu Casa), which:

1. Turns the television on through SmartThings.
2. Takes a Frame TV out of Art Mode.
3. Switches to the HDMI input the machine is on.
4. Sends a Wake-on-LAN packet — the machine boots into the kiosk service on its own.

```yaml
# configuration.yaml
shell_command:
  dashboard_start: >-
    ssh -i /config/.ssh/id_dashboard -o StrictHostKeyChecking=accept-new
    kiosk@dashboard-pc.lan "systemctl --user start dashboard-kiosk.service"
  dashboard_stop: >-
    ssh -i /config/.ssh/id_dashboard -o StrictHostKeyChecking=accept-new
    kiosk@dashboard-pc.lan "systemctl --user stop dashboard-kiosk.service"

script:
  show_dashboard:
    alias: Show the dashboard
    sequence:
      - service: media_player.turn_on
        target: { entity_id: media_player.living_room_tv }
      - delay: "00:00:03"
      - service: media_player.select_source
        target: { entity_id: media_player.living_room_tv }
        data: { source: "HDMI 2" }
      - service: wake_on_lan.send_magic_packet
        data: { mac: "aa:bb:cc:dd:ee:ff" }
      # Harmless if the machine was already awake and running the kiosk.
      - service: shell_command.dashboard_start

  hide_dashboard:
    alias: Turn off the dashboard
    sequence:
      # Exits the kiosk browser and leaves the machine running. The television is
      # deliberately untouched — you may well want to keep watching something.
      - service: shell_command.dashboard_stop
```

Create the SSH key on the Home Assistant host and authorise it for the kiosk user:

```bash
ssh-keygen -t ed25519 -f /config/.ssh/id_dashboard -N ""
ssh-copy-id -i /config/.ssh/id_dashboard.pub kiosk@dashboard-pc.lan
```

Restrict what that key may do, so a compromise of Home Assistant cannot become a
shell on the kiosk machine. In the kiosk user's `~/.ssh/authorized_keys`:

```
command="/usr/local/bin/dashboard-kiosk-ctl",restrict ssh-ed25519 AAAA...
```

with a small script that accepts only `start` and `stop` via `$SSH_ORIGINAL_COMMAND`.

### "Turn off my dashboard"

A second Google Home routine calls `script.hide_dashboard`. This **exits the kiosk
browser** and leaves both the machine and the television as they were.

## Other approaches

**MQTT instead of SSH.** If you already run an MQTT broker, a small subscriber on
the kiosk machine that runs the two `systemctl` commands avoids managing SSH keys
altogether, and gives you availability reporting for free.

**A dedicated always-on device.** A Raspberry Pi behind the television, permanently
on and permanently showing the dashboard, removes Wake-on-LAN and the start command
entirely — the voice routine only has to switch the television's input. Fewer
moving parts than any of the above, and the usual recommendation if the machine is
otherwise flaky about waking.

**No automation at all.** Enable the service and let the machine boot into the
dashboard. Turning the television on is the whole workflow.

## Troubleshooting

**The kiosk does not start on boot.** `loginctl enable-linger` is usually missing.
Check with `systemctl --user status dashboard-kiosk`.

**Wake-on-LAN does nothing.** It usually has to be enabled in the BIOS *and* in the
network adapter's settings, and it will not work over Wi-Fi on most hardware.

**The television switches on but shows the wrong input.** Source names vary between
sets; list the real ones with the `media_player` entity's attributes in Home
Assistant's developer tools.

**The screen is blank after waking.** The desktop's own screen blanking, not the
dashboard. Disable DPMS and the screensaver for the kiosk session.
