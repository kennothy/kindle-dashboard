// Settings for the Kindle dashboard. Change these and save; the next hourly run picks them up.
module.exports = {
  city: "Dubai",
  cityArabic: "دبي",
  latitude: 25.2048,
  longitude: 55.2708,
  timezone: "Asia/Dubai",

  // "dark" (white text on black) or "light" (black text on white)
  theme: "light",

  // Kindle Paperwhite 11th gen screen size
  width: 1236,
  height: 1648,
  footerHeight: 70,

  // Hijri date shift in days, to match the UAE official calendar (IACAD)
  hijriAdjust: -1,

  // Prayer time tuning, in seconds, calibrated against the official IACAD Dubai timetable
  // (same source as Dulook DXB). "mode" is how the time is rounded to the minute.
  prayerTuning: {
    fajr:    { offset: -45,  mode: "ceil" },
    sunrise: { offset: -235, mode: "round" },
    dhuhr:   { offset: 135,  mode: "ceil" },
    asr:     { offset: 75,   mode: "round" },
    maghrib: { offset: 180,  mode: "ceil" },
    isha:    { offset: -5,   mode: "round" },
  },
};
