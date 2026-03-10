// External imports
import express, { Request, Response } from 'express'
import ViteExpress from 'vite-express'
import compression from 'compression'
import cors from 'cors'
import { fileURLToPath } from 'url'
import path from 'path'

// Internal imports
import errorHandler from './middlewares/errorHandler.js'
import logger from './config/logger.js'

import {
    CollectionRepository,
    createCollectionRepository,
} from './repositories/CollectionRepository.js'
import {
    createQuestRepository,
    QuestRepository,
    createQuestToTaxaRepository,
    QuestToTaxaRepository,
} from './repositories/QuestRepository.js'
import {
    createQuestShareRepository,
    QuestShareRepository,
    createSharedQuestProgressRepository,
    SharedQuestProgressRepository,
} from './repositories/QuestShareRepository.js'
import {
    createUserRepository,
    UserRepository,
} from './repositories/UserRepository.js'
import { rateSlowDown } from './middlewares/rateSlowDown.js'
import { default as requestLogger } from './middlewares/requestLogger.js'
import { createAuthService } from './services/authService.js'
import { createQuestService } from './services/questService.js'
import { createQuestShareService } from './services/questShareService.js'
import { createUserService } from './services/userService.js'

import { createAuthController } from './controllers/authController.js'
import { createCollectionController } from './controllers/collectionController.js'
import { createINaturalistAPIController } from './controllers/iNaturalistAPIController.js'
import { createQuestController } from './controllers/questController.js'
import { createQuestShareController } from './controllers/questShareController.js'
import { createUserController } from './controllers/userController.js'
import { createAuthRouter } from './routes/authRouter.js'
import { createCollectionRouter } from './routes/collectionRouter.js'
import { createQuestEventsRouter } from './routes/questEventsRouter.js'
import { createQuestRouter } from './routes/questRouter.js'
import { createQuestShareRouter } from './routes/questShareRouter.js'
import { createUserRouter } from './routes/userRouter.js'
import {
    mapTilesProxyRouter,
    wikipediaProxyRouter,
} from './routes/api/proxies.routes.js'
import { serviceRouter } from './routes/api/services.routes.js'
import corsConfig from './config/cors.config.js'
import { initializeDb } from './config/db.js'
import { getTableColumns } from './utils/getTableColumns.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

async function startServer() {
    try {
        console.log('API: 🚀 Server startup initiated')

        // Validate environment variables
        const env = await import('./config/app.config.js').then(
            (m) => m.default
        )

        // Setup port configuration
        const DEFAULT_PORT = env.PORT || 3000
        const portArg = process.argv.find((arg) => arg.startsWith('--port='))
        const PORT = portArg
            ? parseInt(portArg.split('=')[1], 10)
            : DEFAULT_PORT

        // 🛢️ Initialise database pool and repositories via initApp()
        const deps = await initApp()

        // ☕️ Initialize routes and controllers via buildApp()
        const app = buildApp(deps)
        console.log('API: 📦 App built successfully')

        //  Server setup  //
        if (process.env.NODE_ENV !== 'production') {
            // Error Handler
            app.use(errorHandler)
            ViteExpress.listen(app, PORT, () => {
                console.log(
                    `API: 🌐 Server listening on ${env.PROTOCOL}://${env.HOST}:${PORT}`
                )
                logger.info(
                    `Server running on ${env.PROTOCOL}://${env.HOST}:${PORT} ✅ `
                )
            })
        } else {
            const publicDir = path.join(SCRIPT_DIR, '../../dist/public')

            // Serve static files from the 'public' directory
            app.use(express.static(publicDir))

            // Handle all other routes by serving 'index.html'
            app.get(['*splat'], (req: Request, res: Response) => {
                res.sendFile(path.join(publicDir, 'index.html'))
            })

            // Error Handler
            app.use(errorHandler)

            app.listen(DEFAULT_PORT, '0.0.0.0', () => {
                logger.info(`Server running on ${DEFAULT_PORT} ✅ `) //Log the actual port
            })
        }
        const shutdownHandler = () => {
            logger.info('Shutting down server...')
            // Close database connections, etc.
            process.exit(0)
        }
        process.on('SIGTERM', shutdownHandler)
        process.on('SIGINT', shutdownHandler)
        return true
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'Invalid environment configuration'
        ) {
            logger.error(
                '⛔️ Server startup failed due to invalid environment configuration'
            )
            logger.error(
                'Please check your environment variables and try again'
            )
        } else {
            logger.error('⛔️ Failed to start server:', error)
        }
        process.exit(1)
    }
}

startServer().then(
    (result) => result && logger.info('Server setup complete ✅ ')
)

function buildApp({
    userRepository,
    collectionRepository,
    questRepository,
    questToTaxaRepository,
    questShareRepository,
    sharedQuestProgressRepository,
}: {
    userRepository: UserRepository
    collectionRepository: CollectionRepository
    questRepository: QuestRepository
    questToTaxaRepository: QuestToTaxaRepository
    questShareRepository: QuestShareRepository
    sharedQuestProgressRepository: SharedQuestProgressRepository
}) {
    // initialize express
    const app = express()

    // Enable gzip compression for all responses
    app.use(
        compression({
            level: 6, // Good balance between compression and speed
            threshold: 1024, // Only compress responses larger than 1KB
            filter: (req, res) => {
                // Don't compress EventSource responses
                if (req.headers.accept === 'text/event-stream') {
                    return false
                }
                // Don't compress responses with this request header
                if (req.headers['x-no-compression']) {
                    return false
                }
                // Use compression filter function
                return compression.filter(req, res)
            },
        })
    )

    app.use(express.json())
    app.use(requestLogger)

    // initialize main router
    const apiRouter = express.Router()

    const userService = createUserService(userRepository)
    const userController = createUserController(userService)
    const userRouter = createUserRouter(userController)
    apiRouter.use('/users', userRouter)

    const collectionController =
        createCollectionController(collectionRepository)
    const collectionRouter = createCollectionRouter(collectionController)
    apiRouter.use('/collections', collectionRouter)

    const questService = createQuestService(
        questRepository,
        questToTaxaRepository,
        questShareRepository,
        sharedQuestProgressRepository
    )
    const questController = createQuestController(questService)
    const questRouter = createQuestRouter(questController)
    apiRouter.use('/quests', questRouter)
    const questShareService = createQuestShareService(
        questRepository,
        questToTaxaRepository,
        questShareRepository,
        sharedQuestProgressRepository,
        userRepository
    )

    // Inject questShareService into questService to avoid circular dependency
    questService.setQuestShareService(questShareService)
    const questShareController = createQuestShareController(questShareService)
    const questShareRouter = createQuestShareRouter(questShareController)
    apiRouter.use('/quest-sharing', questShareRouter)
    const questEventsRouter = createQuestEventsRouter(
        questService,
        questShareService
    )
    apiRouter.use('/quests', questEventsRouter)

    const authService = createAuthService(userRepository)
    const authController = createAuthController(authService)
    const authRouter = createAuthRouter(authController)
    apiRouter.use('/auth', authRouter)

    const iNatController = createINaturalistAPIController()
    apiRouter.use(
        '/iNatAPI',
        rateSlowDown,
        // rateLimiter(60 * 1000, 120), // TEMPORARILY DISABLED for debugging
        iNatController
    )
    apiRouter.use('/tiles', mapTilesProxyRouter)
    apiRouter.use('/wikipedia', wikipediaProxyRouter)

    apiRouter.use('/service', serviceRouter)

    apiRouter.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: Date.now() })
    })

    apiRouter.use('/*splat', (req, res) => {
        res.status(404).json({ error: 'No such endpoint' })
    })

    app.use('/api', apiRouter)

    app.use(cors(corsConfig))
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    return app
}

// Initialize db and repositories
export async function initApp() {
    const dbPool = await initializeDb()

    const userColumns = await getTableColumns(dbPool, 'users')
    const userRepository = createUserRepository('users', dbPool, userColumns)

    const collectionColumns = await getTableColumns(dbPool, 'collections')
    const collectionRepository = createCollectionRepository(
        'collections',
        dbPool,
        collectionColumns
    )

    const questToTaxaColumns = await getTableColumns(dbPool, 'quests_to_taxa')
    const questToTaxaRepository = createQuestToTaxaRepository(
        'quests_to_taxa',
        dbPool,
        questToTaxaColumns
    )
    const questTableColumns = await getTableColumns(dbPool, 'quests')
    const questRepository = createQuestRepository(
        'quests',
        dbPool,
        questTableColumns,
        questToTaxaRepository
    )

    // Quest shares + progress
    const questShareColumns = await getTableColumns(dbPool, 'quest_shares')
    const questShareRepository = createQuestShareRepository(
        'quest_shares',
        dbPool,
        questShareColumns
    )
    const progressColumns = await getTableColumns(
        dbPool,
        'shared_quest_progress'
    )
    const sharedQuestProgressRepository = createSharedQuestProgressRepository(
        'shared_quest_progress',
        dbPool,
        progressColumns
    )

    return {
        dbPool,
        userRepository,
        collectionRepository,
        questRepository,
        questToTaxaRepository,
        questShareRepository,
        sharedQuestProgressRepository,
    }
}
