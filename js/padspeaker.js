// Plays sounds through the speaker built into the PS5 DualSense.
//
// The Gamepad API can't reach the speaker. But with a USB cable plugged in, the DualSense is
// also an ordinary sound card ("DualSense Wireless Controller"), so a second AudioContext can be
// sent to it with setSinkId (Chrome / Edge 110+). Over Bluetooth the speaker is not exposed as
// an audio device, so sounds stay on the main speakers.
//
// Out of the box that sound card plays to the controller's headphone jack, not its built-in
// speaker. A USB output report (WebHID) switches the output path to the speaker and sets its
// volume. The controller forgets this when it's unplugged, so it's sent on every (re)connect.

const NAME = /dualsense|dualshock|wireless controller/i;
const KEY = 'mj-pad-speaker';
// The sound effects are mixed quietly for the main speakers (peaks around 0.2), so they're
// boosted a lot for the controller's tiny speaker. A limiter after the boost keeps loud
// moments from clipping into crackle.
const VOL = 5;

const SONY = 0x054c;
const PADS = [0x0ce6, 0x0df2]; // DualSense, DualSense Edge
// USB output report 0x02 (47 bytes after the report id). Only the audio fields are flagged as
// valid, so lights, rumble and triggers are left alone.
const SPEAKER_ON = (() => {
  const r = new Uint8Array(47);
  r[0] = 0x20 | 0x80; // valid: speaker volume, audio control
  r[1] = 0x80;        // valid: audio control 2 (speaker pre-gain)
  r[5] = 0x7f;        // speaker volume: max (the PS5 itself stops at 0x64)
  r[7] = 3 << 4;      // output path: built-in speaker only
  r[37] = 7;          // speaker pre-gain: max (tested: louder and still clean)
  return r;
})();

export const SPEAKER_LABEL = {
  off: 'Off',
  on: 'On',
  searching: 'Looking…',
  'no-usb': 'Plug in with USB',
  'no-hid': 'Allow controller access',
  blocked: 'Allow mic access',
  unsupported: 'Needs Chrome or Edge',
};

export class PadSpeaker {
  constructor() {
    this.ctx = null;
    this.out = null;       // GainNode to play into; null when the controller speaker isn't in use
    this.deviceId = null;
    this.muted = false;
    this.busy = false;
    this.again = false;
    this.onChange = null;  // (status, previous)
    const AC = window.AudioContext;
    this.supported = !!(AC?.prototype?.setSinkId && navigator.mediaDevices?.enumerateDevices);
    try { this.wanted = localStorage.getItem(KEY) === '1'; } catch { this.wanted = false; }
    this.status = !this.supported ? 'unsupported' : 'off';
    if (!this.supported) return;
    // Plugging the cable in or out shows up as a device change.
    navigator.mediaDevices.addEventListener?.('devicechange', () => { if (this.wanted) this.connect(false); });
    navigator.hid?.addEventListener?.('connect', () => this.refresh());
    if (this.wanted) this.connect(false);
  }

  set(status) {
    if (status === this.status) return;
    const prev = this.status;
    this.status = status;
    this.onChange?.(status, prev);
  }

  async setEnabled(on) {
    if (!this.supported) return;
    this.wanted = on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
    if (on) {
      await this.grantHid(); // first, while the click still counts as a user gesture
      await this.connect(true);
    }
    else { this.disconnect(); this.set('off'); }
  }

  /** Re-check after a controller connects (the USB audio device can appear a moment later). */
  refresh() { if (this.wanted && this.supported) this.connect(false); }

  /** The controller's USB HID interfaces this page may use (the ones that take report 0x02). */
  async hidDevices() {
    if (!navigator.hid) return [];
    return (await navigator.hid.getDevices()).filter((d) => d.vendorId === SONY && PADS.includes(d.productId)
      && d.collections.some((c) => c.outputReports?.some((r) => r.reportId === 0x02)));
  }

  /** Ask once for access to the controller, so its speaker can be switched on. */
  async grantHid() {
    if (!navigator.hid) return;
    try {
      if ((await this.hidDevices()).length) return;
      await navigator.hid.requestDevice({ filters: PADS.map((productId) => ({ vendorId: SONY, productId })) });
    } catch { /* chooser closed: connect() reports it */ }
  }

  /** Route the controller's audio to its built-in speaker. True if a controller took it. */
  async speakerOn() {
    let ok = false;
    for (const d of await this.hidDevices()) {
      try {
        if (!d.opened) await d.open();
        await d.sendReport(0x02, SPEAKER_ON);
        ok = true;
      } catch (e) { console.warn('Could not switch the controller speaker on', e); }
    }
    return ok;
  }

  async find(ask) {
    const outputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    let outs = await outputs();
    if (ask && !outs.some((d) => d.label)) {
      // The browser hides device names until the page may use audio devices. Asking once for the
      // microphone reveals them. The mic is closed again right away and never recorded.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      outs = await outputs();
    }
    return outs.find((d) => NAME.test(d.label)) ?? null;
  }

  async connect(ask) {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    if (this.status !== 'on') this.set('searching');
    try {
      const dev = await this.find(ask);
      if (!this.wanted) return;
      if (!dev) { this.disconnect(); this.set('no-usb'); return; }
      // Without this the sound goes to the (empty) headphone jack and the speaker stays silent.
      if (!(await this.speakerOn())) { this.disconnect(); this.set('no-hid'); return; }
      if (!this.wanted) return;
      if (this.ctx && this.deviceId === dev.deviceId) { this.set('on'); return; }
      this.disconnect();
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.setSinkId(dev.deviceId);
      const out = ctx.createGain();
      out.gain.value = this.muted ? 0 : VOL;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -2;
      limit.knee.value = 0;
      limit.ratio.value = 20;
      limit.attack.value = 0.002;
      limit.release.value = 0.08;
      out.connect(limit).connect(ctx.destination);
      this.ctx = ctx;
      this.out = out;
      this.deviceId = dev.deviceId;
      this.resume();
      this.set('on');
    } catch (e) {
      this.disconnect();
      if (this.wanted) this.set(e?.name === 'NotAllowedError' ? 'blocked' : 'no-usb');
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; if (this.wanted) this.connect(false); }
    }
  }

  disconnect() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
    this.deviceId = null;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : VOL;
  }
}
