const User = require('../models/user');

/**
 * Middleware to check if a user is authenticated.
 * It checks for a session and populates the request with the user object if found.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
const requireAuth = async (req, res, next) => {
  if (req.session.userId) {
    try {
      // Find the user by ID and attach it to the request object
      req.user = await User.findById(req.session.userId);
      if (req.user) {
        next();
      } else {
        // If user ID is in session but user not found, destroy session and redirect
        req.session.destroy();
        res.redirect('/login');
      }
    } catch (err) {
      console.error('Error in requireAuth middleware:', err);
      req.session.destroy();
      res.redirect('/login');
    }
  } else {
    // If no user ID in session, redirect to login page
    res.redirect('/login');
  }
};

/**
 * Middleware to check if the authenticated user has one of the required roles.
 * @param {Array<string>} roles - An array of allowed roles (e.g., ['employer', 'admin']).
 * @returns {function} The middleware function.
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if user object exists on the request and if their role is in the allowed roles array
    if (req.user && roles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).send('Access denied');
    }
  };
};

// Export both middleware functions so they can be imported and used in routes
module.exports = {
  requireAuth,
  requireRole
};
