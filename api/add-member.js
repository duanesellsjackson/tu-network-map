export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const member = req.body;

  if (!member.name || !member.phone || !member.city || !member.state) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO;

  try {
    // 1. Fetch current index.html from GitHub
    const fileRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/index.html`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!fileRes.ok) {
      throw new Error('Failed to fetch index.html from GitHub');
    }

    const fileData = await fileRes.json();
    const currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const sha = fileData.sha;

    // 2. Geocode the city/state using free nominatim API
    let lat = null;
    let lng = null;
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(member.city + ', ' + member.state + ', USA')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'TU-Network-Map/1.0' } }
      );
      const geoData = await geoRes.json();
      if (geoData && geoData.length > 0) {
        lat = parseFloat(parseFloat(geoData[0].lat).toFixed(4));
        lng = parseFloat(parseFloat(geoData[0].lon).toFixed(4));
      }
    } catch (geoErr) {
      console.error('Geocoding failed:', geoErr);
    }

    // 3. Build the new member object
    const location = [member.city, member.state].filter(Boolean).join(', ');
    const notes = [
      member.company,
      member.roles,
      member.looking ? `Looking for: ${member.looking}` : '',
      member.markets ? `Markets: ${member.markets}` : '',
      member.email,
      member.website,
      member.notes,
    ].filter(Boolean).join(' · ');

    const newMemberLine = `  {name:${JSON.stringify(member.name)},phone:${JSON.stringify(member.phone)},location:${JSON.stringify(location)},lat:${lat},lng:${lng}${notes ? `,notes:${JSON.stringify(notes)}` : ''}},`;

    // 4. Inject new member into MEMBERS array in index.html
    // Find the last member entry and insert after it
    const insertMarker = '];'; // closing of MEMBERS array
    const insertPoint = currentContent.lastIndexOf('\n  {name:');
    
    if (insertPoint === -1) {
      throw new Error('Could not find insertion point in index.html');
    }

    // Find end of last member line
    const endOfLastMember = currentContent.indexOf('\n', insertPoint + 1);
    const updatedContent =
      currentContent.slice(0, endOfLastMember + 1) +
      newMemberLine + '\n' +
      currentContent.slice(endOfLastMember + 1);

    // 5. Push updated file back to GitHub
    const updateRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/index.html`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Add member: ${member.name}`,
          content: Buffer.from(updatedContent).toString('base64'),
          sha,
        }),
      }
    );

    if (!updateRes.ok) {
      const errData = await updateRes.json();
      throw new Error(`GitHub update failed: ${JSON.stringify(errData)}`);
    }

    return res.status(200).json({ success: true, name: member.name });

  } catch (err) {
    console.error('Error adding member:', err);
    return res.status(500).json({ error: err.message });
  }
}
