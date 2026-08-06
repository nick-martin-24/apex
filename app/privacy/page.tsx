export default function Privacy() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 640 }}>
      <h1>Privacy Policy</h1>
      <p>
        Apex is a personal training application built and used solely by its
        developer. It is not distributed to or used by any other individuals.
      </p>
      <p>
        Apex connects to Strava and WHOOP via OAuth to retrieve the
        developer&apos;s own activity, power, heart rate, and recovery data.
        This data is stored in a private database and used only to generate
        the developer&apos;s own training plans and recommendations. Data is
        never sold, shared, or made available to any third party.
      </p>
      <p>
        The developer may revoke Apex&apos;s access at any time via the
        Strava or WHOOP account settings, which will stop all further data
        collection.
      </p>
      <p>Last updated: {new Date().toISOString().slice(0, 10)}</p>
    </main>
  );
}
