/*jshint bitwise:false, debug:true */
/*global _:true, bean:true, Box2D:true, gapi:true */
/* SHARED STATE:
 * gameState - Global state of the game (these are propagated):
 *             0 - no game is started
 *             1 - game is currently played
 *             2 - game has finished
 * score|ID  - Score for individual players
 * lastScore - Timestamp of last scoring
 */

/* LOCAL STATE:
 * gameState - Local game state:
 *             0 - same as Global
 *             1 - same as Global
 *             2 - same as Global
 *             3 - game was lost locally (ball lost), needs to wait until the end
 *             4 - late join to the game, needs to wait until the end
 */
var rotate,
	speedFactor = 50;
	//<- factor of gravity to negate on impulse. Being multiplied by mass.
	//in ball create method, friction, restitution and mass make for good fun.

window.init = function () {
	"use strict";

	var //baseUrl = document.getElementsByTagName('base').length ? document.getElementsByTagName('base')[0].href : '',
		baseUrl = 'http://dev.welikepie.com/fffDev/',
		game = (function (undefined) {

				// Will hold local participant ID, to mark which of the players
				// in the local game state is considered local; changes coming from
				// shared state to this guy will not be applied.
			var player_id,	
							
				// Local state storage, keeps track of all the players, local and otherwise.
				// Each object, available under the Hangout ID as a key for specific user,
				// has three properties:
				// - state     - Integer, indicating that player's current game state;
				//               local behaviour can be determined by looking at other people's states
				// - score     - Integer, number of points scored by the user
				// - timestamp - Integer, JS timestamp of the last time the state has changed for specified user;
				//               whereas deltas caused by actual changes update the timestamp, heartbeat messages
				//               keep emitting the old timestamp (to prevent unneccessary event triggering on other players)
				players = {},

				submitState = _.debounce(function () {
					var diff = {};
					diff['player|' + player_id] = [
						players[player_id].state,
						players[player_id].score,
						players[player_id].timestamp
					].join('|');
					gapi.hangout.data.submitDelta(diff, []);
				}, 100),

				result = {
					'state': {
						'get': function () {
							return players[player_id].state;
						},
						'set': function (state) {
							var oldState = result.state.get();
							if (state !== oldState) {

								document.getElementsByTagName('body')[0].className = 'state-' + state;

								players[player_id].state = state;
								players[player_id].timestamp = (new Date()).getTime();
								submitState();

								switch (state) {
									case result.state.PLAYING:
										bean.fire(result, 'onGameStart');
										break;
									case result.state.ENDED:
										bean.fire(result, 'onGameEnd');
										break;
									case result.state.LOST:
										bean.fire(result, 'onGameLost');
										break;
									case result.state.LATEJOIN:
										bean.fire(result, 'onLateJoin');
										break;
								}

								result.events.adjustToGlobalState();

							}
						},

						'IDLE' : 0,
						'PLAYING' : 1,
						'ENDED' : 2,
						'LOST' : 3,
						'LATEJOIN' : 4,

						'globalStateCheck': function globalStateCheck (all, def) {

							var states = _.rest(_.toArray(arguments), 2);

							var filtered_players = _.filter(players, function (val, key) { return key !== player_id; });
							if (filtered_players.length) {
								return _[all ? 'every' : 'some'](filtered_players, function (val) { return _.contains(states, val.state); });
							} else {
								return def;
							}

						}
					},
					'score': {
						'getLocal': function () { return players[player_id].score; },
						'getTeam': function () { return _.reduce(players, function (prev, item) { return prev + item.score; }, 0); },

						'setLocal': function (score) {
							var oldScore = result.score.getLocal();
							if (score !== oldScore) {

								players[player_id].score = score;
								players[player_id].timestamp = (new Date()).getTime();
								submitState();

								bean.fire(result, 'onScoreChanged');

							}
						}
					},

					'events': {
						'apiReady': function initializeGame () {

							// Initialise
							player_id = gapi.hangout.getLocalParticipantId();
							players[player_id] = {
								'state': result.state.IDLE,
								'score': 0,
								'timestamp': (new Date()).getTime()
							};

							var lastState = gapi.hangout.data.getState(),
								isLateJoin = false;

							_.each(lastState, function (val, key) {
								if (
									(key.substr(0, 6) === 'player') &&
									(key.substr(7) !== player_id) &&
									(parseInt(val.split('|')[0], 10) === result.state.PLAYING)
								) { isLateJoin = true; }
							});

							if (isLateJoin) { result.state.set(result.state.LATEJOIN); }
							else { submitState(); }

							result.events.changeSharedState({
								'removedKeys': [],
								'addedKeys': _.map(lastState, function (val, key) { return {'key': key, 'value': val}; })
							});

							// Bind event handlers to their respective events
							gapi.hangout.onEnabledParticipantsChanged.add(result.events.changeEnabledParticipants);
							gapi.hangout.data.onStateChanged.add(result.events.changeSharedState);

							// Heartbeat!
							window.setInterval(submitState, 10000);
						
						},
						'changeEnabledParticipants': function changeEnabledParticipants (ev) {

							var removal = [];
							_.chain(players)
								.keys()
								.difference([player_id], _.pluck(ev.enabledParticipants, 'id'))
								.each(function (id) { delete players[id]; removal.push('player|' + id); });

							if (removal.length) {
								gapi.hangout.data.submitDelta({}, removal);
								bean.fire(result, 'onPlayerDropped');
							}

						},
						'changeSharedState': function changeSharedState (ev) {

							var stateChanged = false,
								scoreChanged = false,
								i;

							for (i = 0; i < ev.removedKeys.length; i += 1) {
								if (ev.removedKeys[i].substr(0, 6) === 'player') {
									delete players[ev.removedKeys[i]];
									stateChanged = true;
									scoreChanged = true;
								}
							}

							_.each(ev.addedKeys, function (val) {

								var id, temp, key = val.key;
								val = val.value;

								if (key.substr(0, 6) === 'player') {
									id = key.substr(7);
									if (id !== player_id) {

										var t = val.split('|');
										t = {
											'state': parseInt(t[0], 10),
											'score': parseInt(t[1], 10),
											'timestamp': parseInt(t[2], 10)
										};

										if (!_.has(players, id)) {
											stateChanged = true;
											scoreChanged = true;
										} else if (t.timestamp > players[id].timestamp) {
											if (t.state !== players[id].state) { stateChanged = true; }
											if (t.score !== players[id].score) { scoreChanged = true; }
										}
										console.log('USER [' + id + '] score change to: ', t.score, scoreChanged);
										players[id] = t;

									}
								}

							});

							if (scoreChanged) { bean.fire(result, 'onScoreChanged'); }
							if (stateChanged) { result.events.adjustToGlobalState(); }

						},
						'adjustToGlobalState': function adjustToGlobalState () {

							// Start the game for all when someone starts it
							if ((
								(result.state.get() === result.state.IDLE) ||
								(result.state.get() === result.state.ENDED)
							) && result.state.globalStateCheck(false, false, result.state.PLAYING)) {
								result.state.set(result.state.PLAYING);
							}

							// Finish the game once all the players have dropped their balls
							else if ((
								(result.state.get() === result.state.LOST) ||
								(result.state.get() === result.state.LATEJOIN)
							) && result.state.globalStateCheck(true, true, result.state.LOST, result.state.LATEJOIN, result.state.ENDED)) {
								result.state.set(result.state.ENDED);
							}

						}
					}
				};

			return result;

		}()),

		physics = {
			'world': null,
			'head_tracker': null,
			'ball': null,
			'track_joint': null,
			'track_joint_def': null,
			'movement_factor': 18,
			'speedup_factor': speedFactor,
			'velocity_mods': [],
			'rotateInterval': 20,
			'rotateTimer': null,
			'bounced': false,
			'scaling_map': {
				0.06: 25,
				0.09: 20,
				0.135: 15,
				0.2: 10
			},
			'last_scale': null,

			'ball_overlay': null,
			'ball_overlay_res': null,
			'ball_shadow': null,
			'ball_shadow_res': null,

			'area_width': null,
			'area_height': null,
			'unit_width': null,
			'unit_height': null,
			'rotator': function rotator (rotateObject) {
				if (rotateObject) {
					rotateObject.setRotation(rotateObject.getRotation() + rotate);
				}
			},
			'createTracker': function createTracker () {

				var tracker_position,
					tracker_velocity,
					tracker_angle,
					tracker_joint_present = false,
					body_def = new Box2D.Dynamics.b2BodyDef(),
					fixture_def = new Box2D.Dynamics.b2FixtureDef();

				// Remove current bodies from simulation, if already present
				if (physics.head_tracker) {
					tracker_position = physics.head_tracker.GetWorldCenter();
					tracker_velocity = physics.head_tracker.GetLinearVelocity();
					tracker_angle = physics.head_tracker.GetAngle();
					if (physics.track_joint) {
						tracker_joint_present = true;
						physics.world.DestroyJoint(physics.track_joint);
						physics.track_joint = null;
					}
					physics.world.DestroyBody(physics.head_tracker);
					physics.head_tracker = null;
				}

				if (physics.last_scale) {

					fixture_def.filter = new Box2D.Dynamics.b2FilterData();
					fixture_def.friction = 0.1;
					fixture_def.restitution = 1;

					// Set up and create Head Tracker
					body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
					body_def.bullet = true;
					body_def.allowSleep = false;
					body_def.fixedRotation = true;
					// Prevents the head tracker from rotation - Breakout-paddle-style
					body_def.linearDamping = 1;
					// Makes it so that the head tracker stops to halt when without tracking data

					if (tracker_position) {
						body_def.position = tracker_position;
					} else {
						body_def.position = new Vector(physics.area_width / 2, physics.area_height * 2 / 3);
					}

					if (tracker_velocity) {
						body_def.linearVelocity = tracker_velocity;
					} else {
						body_def.linearVelocity = nullVector;
					}

					if ( typeof tracker_angle !== 'undefined') {
						body_def.angle = tracker_angle;
					}

					//fixture_def.filter.categoryBits = 2;	// Category only for head tracker, only static elements should collide with it
					//fixture_def.filter.maskBits = 1;		// Ensures that the head tracker only collides with static elements
					fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
					fixture_def.shape.SetAsBox(physics.unit_width * 2.5, physics.unit_width);
					fixture_def.density = 999;

					physics.head_tracker = physics.world.CreateBody(body_def);
					physics.head_tracker.CreateFixture(fixture_def);

					if (tracker_joint_present) {
						physics.createJoint();
					}

				}

			},
			'createBall': function createBall () {

				var ball_position,
					ball_velocity,
					body_def = new Box2D.Dynamics.b2BodyDef(),
					fixture_def = new Box2D.Dynamics.b2FixtureDef();

				if (physics.ball) {
					ball_position = physics.ball.GetWorldCenter();
					ball_velocity = physics.ball.GetLinearVelocity();
					physics.world.DestroyBody(physics.ball);
					physics.ball = null;
				}

				if (physics.last_scale) {

					// Set up and create the ball
					body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
					body_def.fixedRotation = false;
					body_def.linearDamping = 0;

					if (ball_position) {
						body_def.position = ball_position;
					} else {
						body_def.position = new Vector(physics.area_width / 2, physics.area_height / 6);
					}

					if (ball_velocity) {
						body_def.linearVelocity = ball_velocity;
					} else {
						body_def.linearVelocity = nullVector;
					}
					//else { body_def.linearVelocity = new Vector(0, physics.movement_factor * physics.speedup_factor); }

					fixture_def.friction = 1;
					fixture_def.restitution = 0.6;
					fixture_def.shape = new Box2D.Collision.Shapes.b2CircleShape();
					fixture_def.shape.SetRadius(physics.unit_width * 1.25);
					fixture_def.density = 10;

					physics.ball = physics.world.CreateBody(body_def);
					physics.ball.CreateFixture(fixture_def);

					_.each(['ball_overlay', 'ball_shadow'], function (type) {

						var resource = type + '_res';

						if (physics[type]) {
							physics[type].setScale(5 / physics.last_scale, gapi.hangout.av.effects.ScaleReference.WIDTH);
						} else {
							if (physics[resource].isLoaded()) {

								physics[type] = physics[resource].createOverlay({
									'position' : {
										'x' : (body_def.position.x / physics.area_width) - 0.5,
										'y' : (body_def.position.y / physics.area_height) - 0.5
									},
									'scale' : {
										'magnitude' : 3 / physics.last_scale,
										'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
									}
								});

							} else {

								physics[type] = {
									'setScale' : function() {},
									'setPosition' : function() {},
									'setVisible' : function() {}
								};

								physics[resource].onLoad.add(function() {
									var pos = physics.ball.GetWorldCenter();
									physics[type] = physics[resource].createOverlay({
										'position' : {
											'x' : (pos.x / physics.area_width) - 0.5,
											'y' : (pos.y / physics.area_height) - 0.5
										},
										'scale' : {
											'magnitude' : 3 / physics.last_scale,
											'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
										}
									});
									physics[type].setVisible(true);
								});

							}
						}

					});

				}

			},
			'destroyTracker': function destroyTracker () {
				if (physics.track_joint) {
					physics.destroyJoint();
				}
				if (physics.head_tracker) {
					physics.world.DestroyBody(physics.head_tracker);
					physics.head_tracker = null;
				}
			},
			'destroyBall': function destroyBall () {

				if (physics.ball_overlay) {
					clearTimeout(physics.rotateTimer);
					physics.ball_overlay.dispose();
					physics.ball_overlay = null;
					physics.ball_shadow.dispose();
					physics.ball_shadow = null;
				}
				if (physics.ball) {
					clearTimeout(physics.rotateTimer);
					physics.world.DestroyBody(physics.ball);
					physics.ball = null;
				}
			},
			'createJoint': function createJoint () {
				try {
					if (physics.track_joint) {
						physics.destroyJoint();
					}
					physics.track_joint_def.bodyA = physics.world.GetGroundBody();
					physics.track_joint_def.bodyB = physics.head_tracker;
					physics.track_joint_def.target = physics.head_tracker.GetWorldCenter();
					physics.track_joint_def.maxForce = 40000.0 * physics.head_tracker.GetMass();
					physics.track_joint = physics.world.CreateJoint(physics.track_joint_def);
				} catch (e) {}
			},
			'destroyJoint': function destroyJoint () {
				if (physics.track_joint) {
					physics.world.DestroyJoint(physics.track_joint);
					physics.track_joint = null;
				}
			}
		},

		Vector = Box2D.Common.Math.b2Vec2,
		nullVector = new Vector(0, 0),

		overlays = {
			'countdown': [
				{'resource': null, 'overlay': null},
				{'resource': null, 'overlay': null},
				{'resource': null, 'overlay': null},
				{'resource': null, 'overlay': null}
			],
			'lost': {'resource': null, 'overlay': null},
			'end': {'resource': null, 'overlay': null}
		},

		audio = {
			'fan_song_res': null,
			'bounce_res': null
		},

		tick = function tick (timestamp) {

			var ball_vel,
				ball_pos;

			if (game.state.get() === game.state.PLAYING) {

				if (physics.ball) {
					var oldTime = 0;
					ball_pos = physics.ball.GetWorldCenter();
					ball_vel = physics.ball.GetLinearVelocity();

					if (physics.bounced === true) {
						/*console.log("-----------------------");
						console.log(physics.ball.GetLinearVelocity());*/
						physics.ball.ApplyImpulse(new Vector(0, -20000 * physics.speedup_factor), physics.ball.GetWorldCenter());
						//console.log(new Vector(0,physics.speedup_factor*-100));
						/*console.log(physics.ball.GetLinearVelocity());
						console.log("-----------------------");*/
						physics.bounced = false;
					}

					if (physics.ball_overlay && physics.ball_shadow) {
						physics.ball_overlay.setPosition((ball_pos.x / physics.area_width) - 0.5, (ball_pos.y / physics.area_height) - 0.5);
						physics.ball_shadow.setPosition((ball_pos.x / physics.area_width) - 0.5, (ball_pos.y / physics.area_height) - 0.5);

					}

					if (ball_pos.y > physics.area_height * 1.25) {
						game.state.set(game.state.LOST);
					}
				}

				physics.world.Step(1 / 20, 5, 5);
				physics.world.DrawDebugData();
				physics.world.ClearForces();
				if ((typeof timestamp !== 'boolean') || !timestamp) {
					window.requestAnimationFrame(tick);
				}

			}

		},

		initialize = function () {

			// Ensure camera mirroring
			gapi.hangout.av.setLocalParticipantVideoMirrored(true);

			// BIND GAME EVENTS
			bean.on(game, 'onGameStart', function onGameStart () {

				var start_time,
					init_overlay = physics.ball_overlay_res.createOverlay({
						'position' : {
							'x' : 0,
							'y' : 0
						},
						'scale' : {
							'magnitude' : 0,
							'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
						}
					}),
					init_shadow = physics.ball_shadow_res.createOverlay({
						'position' : {
							'x' : 0,
							'y' : 0
						},
						'scale' : {
							'magnitude' : 0,
							'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
						}
					}),
					countdown_func = function countdown_func (index) {

						if ((overlays.countdown.length - 1) > index) {
							try { overlays.countdown[index + 1].overlay.setVisible(false); } catch (e) {}
						}

						if (index >= 0) {
							try {
								overlays.countdown[index].overlay.setVisible(true);
							} catch (e) {}
							window.setTimeout(_.bind(countdown_func, this, index - 1), 750);
						} else {
							try {
								init_overlay.setVisible(true);
								init_shadow.setVisible(true);
							} catch (e) {}
							start_time = (new Date()).getTime();
							window.setTimeout(function() { ballanim_func((new Date()).getTime()); }, 50);
						}
					},
					ballanim_func = function ballanim_func (timestamp) {

						var factor = (timestamp - start_time) / 1000, limiter;
						if (factor >= 1) {

							try {
								init_shadow.setVisible(false);
								init_overlay.setVisible(false);
								init_overlay.dispose();
								init_shadow.dispose();
								init_overlay = null;
								init_shadow = null;
								if (physics.ball_overlay && physics.ball_shadow) {
									physics.ball_overlay.setVisible(true);
									physics.ball_shadow.setVisible(true);
								}
							} catch (e) {}

							// Establish movement limited for the physics engine
							limiter = function limiter () {
								if (Box2D.Common.b2Settings.b2_maxTranslation < 8) {
									Box2D.Common.b2Settings.b2_maxTranslation += 0.25;
								}
								if (game.state.get() === game.state.PLAYING) {
									window.setTimeout(limiter, 1000);
								}
							};
							Box2D.Common.b2Settings.b2_maxTranslation = 1.0;
							window.setTimeout(limiter, 1000);
							window.requestAnimationFrame(tick);

						} else {
							try {
								init_overlay.setScale(factor * 0.75, gapi.hangout.av.effects.ScaleReference.HEIGHT);
								init_shadow.setScale(factor * 0.75, gapi.hangout.av.effects.ScaleReference.HEIGHT);
							} catch (e) {}

							window.setTimeout(function() { ballanim_func((new Date()).getTime()); }, 50);
						}
					};

				// Reset the score
				game.score.setLocal(0);

				physics.createTracker();
				physics.createBall();
				try {
					if (physics.ball_overlay && physics.ball_shadow) {
						physics.ball_overlay.setVisible(false);
						physics.ball_shadow.setVisible(false);
					}
					init_overlay.setVisible(false);
					init_shadow.setVisible(false);
				} catch (e) {}
				countdown_func(3);

			});

			bean.on(game, 'onGameLost', function onGameLost () {

				console.log("gameLost");
				physics.destroyTracker();
				physics.destroyBall();

				overlays.lost.overlay.setVisible(true);
				window.setTimeout(_.bind(overlays.lost.overlay.setVisible, overlays.lost.overlay, false), 1000);

			});

			bean.on(game, 'onGameEnd', function onGameEnd() {

				console.log('gameEnded');
				overlays.end.overlay.setVisible(true);
				window.setTimeout(_.bind(overlays.end.overlay.setVisible, overlays.end.overlay, false), 1000);

			});

			var changePoints = function changePoints (counter, amount) {

				var old_amount = parseInt(counter.innerHTML.length ? counter.innerHTML : '0', 10),
					counter_pos = [],
					anim_func,
					style_func,
					i;

				if (amount >= 1000) { amount = 999; }
				amount = '' + amount;

				if (old_amount !== amount) {

					for (i = Math.max(amount.length, old_amount.length) - 1; i >= 0; i -= 1) {
						if (amount.substr(i, 1) !== old_amount.substr(i, 1)) {
							counter_pos.push(i);
						}
					}

					counter_pos.sort();
					counter_pos = _.map(counter_pos, function(index) {
						var el = document.createElement('div');
						el.className = 'counter step3';
						el.style.left = (index * 80) + 'px';
						counter.appendChild(el);
						return el;
					});

					i = 3;
					style_func = function counter_style_func (el) { el.className = 'counter step' + i; };
					anim_func = function counter_anim_func () {

						i -= 1;
						if (i === -1) { counter.innerHTML = amount; }
						if (i < 0) {
							_.each(counter_pos, function (el) {
								try { counter.removeChild(el); } catch (e) {}
							});
						} else {
							_.each(counter_pos, style_func);
							window.setTimeout(anim_func, 100);
						}
					};
					window.setTimeout(anim_func, 100);

				}

			};
			bean.on(game, 'onScoreChanged', function onScoreChanged () {

				// Update DOM to reflect new points
				changePoints(document.getElementById('local'), game.score.getLocal());
				changePoints(document.getElementById('team'), game.score.getTeam());

			});
			bean.on(game, 'onPlayerDropped', _.bind(bean.fire, bean, game, 'onScoreChanged'));

			// DOM EVENT BINDINGS
			// ------------------
			bean.on(document.getElementsByTagName('button')[0], 'click', function (ev) {
				ev.preventDefault();
				ev.stopPropagation();
				if (physics.ball_overlay_res.isLoaded() && physics.ball_shadow_res.isLoaded()) {
					if (
						(game.state.get() === game.state.IDLE) ||
						(game.state.get() === game.state.ENDED)
					) { game.state.set(game.state.PLAYING); }
				}
			});
			bean.on(document.getElementById('share'), 'click', function (ev) {
				ev.preventDefault();
				ev.stopPropagation();
				window.open(document.getElementById('share').href, 'Share', 'width=600,height=450');
			});

			// Load audio resources
			audio.bounce_res = gapi.hangout.av.effects.createAudioResource(baseUrl + "audio/bounceFinal.wav");
			audio.fan_song_res = gapi.hangout.av.effects.createAudioResource(baseUrl + "audio/crowdSound8.wav");
			audio.fan_song_res.onLoad.add(function (ev) {
				if (ev.isLoaded) {
					audio.fan_song_res.play({
						'localOnly': true,
						'loop': true,
						'volume': 0.8
					});
				}
			});

			// Load image resources
			physics.ball_overlay_res = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/ball.png');
			physics.ball_shadow_res = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/ballShadow.png');

			overlays.lost.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_lost.png');
			overlays.lost.resource.onLoad.add(function createOverlay(ev) {
				if (ev.isLoaded) {
					overlays.lost.overlay = overlays.lost.resource.createOverlay({
						'position' : {
							'x' : 0,
							'y' : 0
						},
						'scale' : {
							'magnitude' : 0.35,
							'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
						}
					});
					overlays.lost.overlay.setVisible(false);
				}
			});
			overlays.end.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_end.png');
			overlays.end.resource.onLoad.add(function createOverlay(ev) {
				if (ev.isLoaded) {
					overlays.end.overlay = overlays.end.resource.createOverlay({
						'position' : {
							'x' : 0,
							'y' : 0
						},
						'scale' : {
							'magnitude' : 0.35,
							'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
						}
					});
					overlays.end.overlay.setVisible(false);
				}
			});
			_.each(overlays.countdown, function(obj, index) {

				obj.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_count' + index + '.png');
				obj.resource.onLoad.add(function createOverlay(ev) {
					if (ev.isLoaded) {
						obj.overlay = obj.resource.createOverlay({
							'position' : {
								'x' : 0,
								'y' : 0
							},
							'scale' : {
								'magnitude' : 0.35,
								'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
							}
						});
						obj.overlay.setVisible(false);
					}
				});

			});

		},

		phys_initialize = function () {

			var video = gapi.hangout.layout.getVideoCanvas(),
				scaling_keys = _.map(_.keys(physics.scaling_map), parseFloat),
				body_def = new Box2D.Dynamics.b2BodyDef(),
				fixture_def = new Box2D.Dynamics.b2FixtureDef(),
				contact = new Box2D.Dynamics.b2ContactListener();

			physics.area_width = video.getWidth();
			physics.area_height = video.getHeight();
			if (document.getElementById('physics_test')) {
				document.getElementById('physics_test').width = physics.area_width;
				document.getElementById('physics_test').height = physics.area_height;
			}

			// Set up world with null gravity
			physics.world = new Box2D.Dynamics.b2World(new Vector(0, 9.8), false);

			// Establish side walls to prevent the ball from falling off sides
			body_def.type = Box2D.Dynamics.b2Body.b2_staticBody;
			fixture_def.friction = 0.5;
			fixture_def.restitution = 0.8;
			fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
			fixture_def.shape.SetAsBox(2, physics.area_height * 10);

			body_def.position.Set(-1, 0);
			physics.world.CreateBody(body_def).CreateFixture(fixture_def);
			body_def.position.Set(physics.area_width + 1, 0);
			physics.world.CreateBody(body_def).CreateFixture(fixture_def);

			// Set one up at the top to prevent ball from falling off-screen
			fixture_def.shape.SetAsBox(physics.area_width * 2, 2);
			body_def.position.Set(physics.area_width / 2, physics.area_height / -8);
			body_def.restitution = 0.8;
			physics.world.CreateBody(body_def).CreateFixture(fixture_def);

			// Set up contact listener
			contact.BeginContact = function (contact) {
				var bodyA = contact.GetFixtureA().GetBody(),
					bodyB = contact.GetFixtureB().GetBody(),
					delta, id;

				if (
					((bodyA === physics.head_tracker) && (bodyB === physics.ball)) ||
					((bodyA === physics.ball) && (bodyB === physics.head_tracker))
				) {

					bodyA = physics.head_tracker;
					bodyB = physics.ball;

					// Only count downward-moving ball
					if (bodyB.GetLinearVelocity().y > 0) {

						game.score.setLocal(game.score.getLocal() + 1);

						physics.lastVelocity = physics.ball.GetLinearVelocity();
						physics.bounced = true;
						audio.bounce_res.play({
							localOnly : true,
							loop : false,
							volume : 1
						});

					}

				}
			};

			contact.EndContact = function (contact) {

				var bodyA = physics.head_tracker,
					bodyB = physics.ball,
					ball_velocity = physics.ball.GetLinearVelocity(),
					new_velocity = physics.lastVelocity,
					temp = ball_velocity.Length();

				window.clearInterval(physics.rotateTimer);
				rotate = (0.5 - Math.random()) / 10;
				//rotateInterval
				physics.rotateTimer = window.setInterval(function () {
					physics.rotator(physics.ball_overlay);
				}, physics.rotateInterval);

			};

			physics.world.SetContactListener(contact);

			// Set up mouse joint definition
			physics.track_joint_def = new Box2D.Dynamics.Joints.b2MouseJointDef();

			// Set up debug tracking of the world
			if (document.getElementById('physics_test')) {
				var debugDraw = new Box2D.Dynamics.b2DebugDraw();
				debugDraw.SetSprite(document.getElementById("physics_test").getContext("2d"));
				debugDraw.SetDrawScale(1.0);
				debugDraw.SetFillAlpha(0.5);
				debugDraw.SetLineThickness(1.0);
				debugDraw.SetFlags(Box2D.Dynamics.b2DebugDraw.e_shapeBit | Box2D.Dynamics.b2DebugDraw.e_jointBit);
				physics.world.SetDebugDraw(debugDraw);
			}

			var faceDataChange = function faceDataChange (faceData) {

				var biggest_scale = -1,
					currentState = game.state.get(),
					scale, i;

				if (faceData.hasFace) {

					// Calculate the scale (and adjust object accordingly if scale is different from previous frame)
					scale = Math.abs(faceData.leftEye.x - faceData.rightEye.x);
					for (i = 0; i < scaling_keys.length; i += 1) {
						if (scaling_keys[i] <= scale && scaling_keys[i] > biggest_scale) {
							biggest_scale = scaling_keys[i];
						}
					}
					if (biggest_scale === -1) { biggest_scale = scaling_keys[0]; }

					// Determine what scales to applya
					if (physics.scaling_map[biggest_scale] !== physics.last_scale) {

						physics.last_scale = physics.scaling_map[biggest_scale];
						physics.unit_width = physics.area_width / physics.last_scale;
						physics.unit_height = physics.area_height / physics.last_scale;

						if (currentState === game.state.PLAYING) {
							physics.createTracker();
							physics.createBall();
						}

					}

					if (currentState === game.state.PLAYING) {

						// Track face position
						if (!physics.track_joint) { physics.createJoint(); }
						physics.track_joint.SetTarget(new Vector(
							(faceData.noseRoot.x + 0.5) * physics.area_width,
							(faceData.noseRoot.y - Math.abs(faceData.leftEye.x - faceData.rightEye.x) + 0.5) * physics.area_height
						));
						physics.head_tracker.SetAngle(faceData.roll);

					}

				} else {

					if (currentState === game.state.PLAYING) {

						// Disable face tracking if data not present
						if (physics.track_joint) {
							physics.destroyJoint();
						}

					}

				}

			};
			gapi.hangout.av.effects.onFaceTrackingDataChanged.add(faceDataChange);
			faceDataChange({
				'hasFace' : true,
				'leftEye' : {'x' : -0.05, 'y' : 0},
				'rightEye' : {'x' : 0.05, 'y' : 0},
				'noseRoot' : {'x' : 0, 'y' : 0},
				'roll' : 0
			});

		};

	gapi.hangout.onApiReady.add(initialize);
	gapi.hangout.onApiReady.add(game.events.apiReady);
	gapi.hangout.onApiReady.add(phys_initialize);

};