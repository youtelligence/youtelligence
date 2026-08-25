const { lookupChannelId } = require('./competitors.js');

const handle = process.argv[2];

if (!handle) {
  console.error('Usage: node lookup_channel_id.js <@handle>');
  process.exit(1);
}

lookupChannelId(handle)
  .then(({ id }) => console.log(id))
  .catch((err) => {
    console.error(`Failed to look up channel id for ${handle}:`, err);
    process.exit(1);
  });
