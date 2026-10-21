'use strict';
// Public search entry points shared by UI services, MCP and computation workers.
module.exports={
  ...require('./normal'),
  ...require('./expedition'),
  routeAirReference:require('../domain/routes/route_air').routeAirReference,
  airLoadout:require('./fitting').airLoadout
};
